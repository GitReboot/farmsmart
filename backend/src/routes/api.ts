import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { getClimate, MONTH_NAMES } from '../analysis/climate.js';
import { rankCrops, scoreCrop } from '../analysis/cropScoring.js';
import { buildActionCard } from '../analysis/forecastRules.js';
import { buildStages, templateTips } from '../analysis/growPlan.js';
import { CROP_IDS, CROPS, cropById } from '../data/crops.js';
import { LANGUAGE_CODES, LANGUAGES } from '../data/languages.js';
import { HttpError } from '../lib/errors.js';
import { resolveLocation } from '../services/location.js';
import { fetchForecast } from '../services/openMeteo.js';
import { fetchSoil } from '../services/soilGrids.js';
import { generatePlan, llmEnabled } from '../services/llm.js';

export const api = Router();

const DISCLAIMER = 'Advisory estimate based on historical climate and weather forecasts. Not a guarantee; combine with advice from your local extension officer.';

const locationInput = {
  city: z.string().trim().min(1).max(100),
  country: z.string().trim().min(1).max(60),
};

function parse<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new HttpError(400, 'INVALID_INPUT', 'Request body is invalid.', result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

const meta = (sources: string[]) => ({ sources, generatedAt: new Date().toISOString(), disclaimer: DISCLAIMER });

// The LLM endpoint costs money per call; keep it tighter than the global limit.
const llmLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

api.get('/health', (_req, res) => {
  res.json({ ok: true, llm: llmEnabled() ? 'openai' : 'template-fallback' });
});

api.get('/crops', (_req, res) => {
  res.json({ crops: CROPS.map((c) => ({ id: c.id, name: c.name, seasonDays: c.seasonDays, droughtTolerance: c.droughtTolerance })) });
});

api.get('/languages', (_req, res) => {
  res.json({ languages: Object.entries(LANGUAGES).map(([code, name]) => ({ code, name })) });
});

/** Climate profile: 20-year history, recency-weighted, with trends and plain-language insights. */
api.post('/climate', async (req, res) => {
  const { city, country } = parse(z.object(locationInput), req);
  const { location, alternatives } = await resolveLocation(city, country);
  const climate = await getClimate(location.lat, location.lon);
  res.json({ location, alternatives, climate: climate.profile, meta: meta(['Open-Meteo Historical (ERA5)']) });
});

/** Ranked crop suggestions with best planting month and reasons. */
api.post('/recommend', async (req, res) => {
  const body = parse(z.object({ ...locationInput, irrigation: z.boolean().default(false), limit: z.number().int().min(1).max(20).default(5) }), req);
  const { location, alternatives } = await resolveLocation(body.city, body.country);
  const [climate, soil] = await Promise.all([getClimate(location.lat, location.lon), fetchSoil(location.lat, location.lon)]);
  const recommendations = rankCrops(climate, { irrigation: body.irrigation, soil });
  res.json({
    location,
    alternatives,
    soil,
    climateSummary: pickSummary(climate.profile),
    recommendations: recommendations.slice(0, body.limit),
    otherCrops: recommendations.slice(body.limit).map((r) => ({ cropId: r.cropId, crop: r.crop, score: r.score, risk: r.risk })),
    meta: meta(['Open-Meteo Historical (ERA5)', soil ? 'ISRIC SoilGrids' : 'Soil data unavailable', 'FAO ECOCROP crop requirements (approx.)']),
  });
});

/** 7-day action card for a specific crop. */
api.post('/forecast', async (req, res) => {
  const body = parse(z.object({ ...locationInput, crop: z.enum(CROP_IDS).default('maize') }), req);
  const { location, alternatives } = await resolveLocation(body.city, body.country);
  const crop = cropById(body.crop)!;
  const fc = await fetchForecast(location.lat, location.lon);
  res.json({ location, alternatives, crop: { id: crop.id, name: crop.name }, ...buildActionCard(fc, crop), meta: meta(['Open-Meteo Forecast']) });
});

/** Month-by-month growing plan. Timeline and numbers are computed here; the LLM only writes the tips. */
api.post('/grow-plan', llmLimiter, async (req, res) => {
  const body = parse(
    z.object({
      ...locationInput,
      crop: z.enum(CROP_IDS),
      plantingMonth: z.number().int().min(1).max(12).optional(),
      irrigation: z.boolean().default(false),
      language: z.enum(LANGUAGE_CODES).default('en'),
    }),
    req,
  );
  const { location, alternatives } = await resolveLocation(body.city, body.country);
  const crop = cropById(body.crop)!;
  const [climate, soil] = await Promise.all([getClimate(location.lat, location.lon), fetchSoil(location.lat, location.lon)]);
  const rec = scoreCrop(crop, climate, { irrigation: body.irrigation, soil });
  if (!rec) throw new HttpError(422, 'INSUFFICIENT_DATA', 'Not enough historical data to plan this crop here.');

  const plantingMonth = body.plantingMonth ?? rec.plantingMonth;
  const stages = buildStages(crop, plantingMonth, climate.profile);

  // Only computed, validated values go to the LLM — no free text from the user.
  const context = {
    crop: crop.name,
    region: `${location.admin1 ? `${location.admin1}, ` : ''}${location.country}`,
    elevationM: location.elevationM,
    irrigationAvailable: body.irrigation,
    plantingMonth,
    suitabilityScore: rec.score,
    pastSuccess: `${rec.successYears} of ${rec.totalYears} seasons`,
    expectedSeason: rec.expected,
    cropNeeds: { rainMm: crop.rainOpt, idealTempC: crop.tOpt, heatStressAboveC: crop.heatStressC, criticalStage: crop.critical.name, soilPh: crop.ph },
    soil,
    stages: stages.map(({ id, name, startDate, endDate, climate: c }) => ({ id, name, startDate, endDate, ...c })),
    climateTrend: climate.profile.recentVsLongTerm,
    warnings: rec.warnings,
  };

  const plan = await generatePlan(context, LANGUAGES[body.language]);
  const tipsFor = (id: string) => plan?.stages.find((s) => s.stageId === id)?.tips;
  const filled = stages.map((s) => ({ ...s, tips: tipsFor(s.id)?.length ? tipsFor(s.id)! : templateTips(crop, s, rec, body.irrigation) }));

  res.json({
    location,
    alternatives,
    crop: { id: crop.id, name: crop.name, seasonDays: crop.seasonDays },
    plantingMonth,
    suitability: { score: rec.score, risk: rec.risk, successYears: rec.successYears, totalYears: rec.totalYears },
    summary: plan?.summary ?? `${crop.name} planted mid-${MONTH_NAMES[plantingMonth - 1]} has a suitability score of ${rec.score}/100 here and worked in ${rec.successYears} of the last ${rec.totalYears} seasons.`,
    varietyAdvice: plan?.varietyAdvice ?? (rec.expected.seasonRainMm < crop.rainOpt[0] ? 'Choose an early-maturing, drought-tolerant variety.' : 'Choose a locally recommended, disease-resistant variety.'),
    stages: filled,
    risks: plan?.risks ?? rec.warnings.map((w) => ({ title: 'Watch out', mitigation: w })),
    warnings: rec.warnings,
    language: plan ? body.language : 'en',
    adviceSource: plan ? 'ai' : 'template',
    meta: meta(['Open-Meteo Historical (ERA5)', soil ? 'ISRIC SoilGrids' : 'Soil data unavailable', plan ? 'OpenAI (wording only)' : 'Rule-based template']),
  });
});

/** One call for the main screen: location, climate profile, top crops, and this week's action card for the best crop. */
api.post('/analyze', async (req, res) => {
  const body = parse(z.object({ ...locationInput, irrigation: z.boolean().default(false), crop: z.enum(CROP_IDS).optional() }), req);
  const { location, alternatives } = await resolveLocation(body.city, body.country);
  const [climate, soil, fc] = await Promise.all([
    getClimate(location.lat, location.lon),
    fetchSoil(location.lat, location.lon),
    fetchForecast(location.lat, location.lon).catch(() => null), // forecast is optional for this view
  ]);
  const recommendations = rankCrops(climate, { irrigation: body.irrigation, soil });
  const focusCrop = cropById(body.crop ?? recommendations[0]?.cropId ?? 'maize')!;
  res.json({
    location,
    alternatives,
    soil,
    climate: climate.profile,
    recommendations: recommendations.slice(0, 5),
    otherCrops: recommendations.slice(5).map((r) => ({ cropId: r.cropId, crop: r.crop, score: r.score, risk: r.risk })),
    thisWeek: fc ? { crop: { id: focusCrop.id, name: focusCrop.name }, ...buildActionCard(fc, focusCrop) } : null,
    meta: meta(['Open-Meteo Historical (ERA5)', 'Open-Meteo Forecast', soil ? 'ISRIC SoilGrids' : 'Soil data unavailable', 'FAO ECOCROP crop requirements (approx.)']),
  });
});

function pickSummary(p: Awaited<ReturnType<typeof getClimate>>['profile']) {
  return {
    period: p.period,
    annualRainMm: p.annual.rainMm,
    meanTempC: p.annual.meanTempC,
    recentVsLongTerm: p.recentVsLongTerm,
    trendPerDecade: p.trendPerDecade,
    growingSeasons: p.growingSeasons,
    insights: p.insights,
  };
}
