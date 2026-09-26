import { CROPS, type Crop } from '../data/crops.js';
import { clamp, round, trapezoid, weightedMean } from '../lib/stats.js';
import type { SoilInfo } from '../services/soilGrids.js';
import { MONTH_NAMES, yearWeight, type ClimateData } from './climate.js';

export interface ScoreOptions {
  irrigation: boolean;
  soil: SoilInfo | null;
}

interface SeasonResult {
  year: number;
  weight: number;
  rain: number;
  meanT: number;
  heatDays: number;
  frostDays: number;
  maxDrySpell: number;
  irrigationNeed: number;
  ok: boolean;
}

export interface MonthEvaluation {
  month: number;
  score: number;
  seasons: SeasonResult[];
  expected: { seasonRainMm: number; meanTempC: number; heatStressDays: number; frostDays: number; drySpellDays: number; irrigationNeedMm: number };
  successYears: number;
  weightedSuccess: number;
  parts: { temperature: number; water: number; reliability: number; soil: number | null };
}

export interface CropRecommendation {
  cropId: string;
  crop: string;
  score: number;
  risk: 'low' | 'medium' | 'high';
  droughtTolerance: Crop['droughtTolerance'];
  plantingMonth: number;
  plantingMonthName: string;
  harvestMonthName: string;
  goodPlantingMonths: string[];
  /** Score (0–100) for planting on the 15th of each month Jan..Dec — useful for a planting-calendar heatmap. */
  monthScores: number[];
  successYears: number;
  totalYears: number;
  expected: MonthEvaluation['expected'];
  scoreBreakdown: MonthEvaluation['parts'];
  reasons: string[];
  warnings: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Replay one planting month against every past year and score the outcome. */
export function evaluateMonth(crop: Crop, month: number, climate: ClimateData, opts: ScoreOptions): MonthEvaluation | null {
  const { records, dateIndex, startYear, endYear } = climate;
  const seasons: SeasonResult[] = [];

  for (let y = startYear; y <= endYear; y++) {
    const start = dateIndex.get(`${y}-${pad(month)}-15`);
    if (start === undefined) continue;
    const end = start + crop.seasonDays;
    if (end > records.length) continue; // season runs past the end of the data

    const cs = start + Math.floor(crop.seasonDays * crop.critical.window[0]);
    const ce = start + Math.floor(crop.seasonDays * crop.critical.window[1]);
    let rain = 0;
    let tsum = 0;
    let etc = 0;
    let heat = 0;
    let frost = 0;
    let dry = 0;
    let maxDry = 0;
    for (let i = start; i < end; i++) {
      const r = records[i];
      rain += r.rain;
      tsum += r.tmean;
      etc += r.et0 * crop.kc;
      if (r.tmin < 2) frost++;
      if (i >= cs && i < ce) {
        if (r.tmax >= crop.heatStressC) heat++;
        dry = r.rain < 1 ? dry + 1 : 0;
        maxDry = Math.max(maxDry, dry);
      }
    }
    const meanT = tsum / crop.seasonDays;
    const ok =
      meanT >= crop.tAbs[0] &&
      meanT <= crop.tAbs[1] &&
      heat <= 5 &&
      (!crop.frostSensitive || frost <= 1) &&
      (opts.irrigation || (rain >= crop.rainAbsMin && maxDry < 21));

    seasons.push({
      year: y,
      weight: yearWeight(y, endYear),
      rain,
      meanT,
      heatDays: heat,
      frostDays: frost,
      maxDrySpell: maxDry,
      // ~80% of rain is "effective" (the rest runs off or evaporates).
      irrigationNeed: Math.max(0, etc - 0.8 * rain),
      ok,
    });
  }
  if (seasons.length < 5) return null;

  const ws = seasons.map((s) => s.weight);
  const w = (f: (s: SeasonResult) => number) => weightedMean(seasons.map(f), ws);
  const expected = {
    seasonRainMm: round(w((s) => s.rain)),
    meanTempC: round(w((s) => s.meanT), 1),
    heatStressDays: round(w((s) => s.heatDays), 1),
    frostDays: round(w((s) => s.frostDays), 1),
    drySpellDays: round(w((s) => s.maxDrySpell)),
    irrigationNeedMm: round(w((s) => s.irrigationNeed) / 10) * 10,
  };

  // Temperature: inside the optimal band scores 0.75–1, peaking at its midpoint.
  const [tLo, tHi] = crop.tOpt;
  const tMid = (tLo + tHi) / 2;
  const temperature =
    trapezoid(expected.meanTempC, crop.tAbs[0], tLo, tHi, crop.tAbs[1]) * (1 - 0.25 * clamp(Math.abs(expected.meanTempC - tMid) / ((tHi - tLo) / 2), 0, 1));

  // Water: half "is rain in the crop's range", half "does effective rain cover crop water use (ET0 × Kc)".
  const [optLo, optHi] = crop.rainOpt;
  const range =
    expected.seasonRainMm < optLo
      ? clamp((expected.seasonRainMm - crop.rainAbsMin) / (optLo - crop.rainAbsMin), 0, 1)
      : expected.seasonRainMm <= optHi
        ? 1
        : clamp(1 - (0.5 * (expected.seasonRainMm - optHi)) / optHi, 0.4, 1); // too wet: waterlogging, disease
  const coverage = w((s) => clamp((0.8 * s.rain) / (0.8 * s.rain + s.irrigationNeed || 1), 0, 1));
  let water = 0.5 * range + 0.5 * coverage;
  if (opts.irrigation) water = Math.max(water, 0.9);

  const weightedSuccess = w((s) => (s.ok ? 1 : 0));
  const soil = opts.soil?.ph != null ? trapezoid(opts.soil.ph, crop.ph[0] - 1, crop.ph[0], crop.ph[1], crop.ph[1] + 1) : null;

  // Stress penalties: very hot days and long dry spells during the critical stage.
  const penalty = clamp(expected.heatStressDays * 0.02, 0, 0.15) + (opts.irrigation ? 0 : clamp((expected.drySpellDays - 10) * 0.01, 0, 0.1));

  const core = 0.3 * temperature + 0.3 * water + 0.3 * weightedSuccess;
  const score = clamp((soil == null ? core / 0.9 : core + 0.1 * soil) - penalty, 0, 1);

  return {
    month,
    score,
    seasons,
    expected,
    successYears: seasons.filter((s) => s.ok).length,
    weightedSuccess,
    parts: { temperature: round(temperature, 2), water: round(water, 2), reliability: round(weightedSuccess, 2), soil: soil == null ? null : round(soil, 2) },
  };
}

function explain(crop: Crop, ev: MonthEvaluation, opts: ScoreOptions): { reasons: string[]; warnings: string[] } {
  const e = ev.expected;
  const reasons: string[] = [];
  const warnings: string[] = [];

  reasons.push(`Worked in ${ev.successYears} of the last ${ev.seasons.length} seasons when planted mid-${MONTH_NAMES[ev.month - 1]}.`);
  reasons.push(`Expected season rain ~${e.seasonRainMm} mm (this crop needs ${crop.rainOpt[0]}–${crop.rainOpt[1]} mm).`);
  reasons.push(`Average temperature ~${e.meanTempC}°C (ideal ${crop.tOpt[0]}–${crop.tOpt[1]}°C).`);
  if (opts.soil?.ph != null) {
    const fits = opts.soil.ph >= crop.ph[0] && opts.soil.ph <= crop.ph[1];
    (fits ? reasons : warnings).push(
      fits
        ? `Soil pH ${opts.soil.ph} suits this crop (${crop.ph[0]}–${crop.ph[1]}).`
        : `Soil pH ${opts.soil.ph} is outside the ideal ${crop.ph[0]}–${crop.ph[1]}; ${opts.soil.ph < crop.ph[0] ? 'liming' : 'adding organic matter'} can help.`,
    );
  }

  if (e.seasonRainMm < crop.rainOpt[0]) {
    warnings.push(
      opts.irrigation
        ? `Rain alone is not enough; plan for ~${e.irrigationNeedMm} mm of irrigation over the season.`
        : `Rain is usually below what this crop needs; expect a shortfall of ~${e.irrigationNeedMm} mm without irrigation.`,
    );
  }
  if (e.seasonRainMm > crop.rainOpt[1] * 1.3) warnings.push('Often too wet for this crop: plant on ridges or raised beds and watch for fungal disease.');
  if (e.heatStressDays >= 2) warnings.push(`About ${round(e.heatStressDays)} very hot days (≥${crop.heatStressC}°C) during ${crop.critical.name}.`);
  if (!opts.irrigation && e.drySpellDays >= 14) warnings.push(`Dry spells of ~${e.drySpellDays} days are common during ${crop.critical.name}, the most water-sensitive stage.`);
  if (e.frostDays >= 1 && crop.frostSensitive) warnings.push('Cold nights near frost are possible; avoid the coldest months.');

  return { reasons, warnings };
}

export function scoreCrop(crop: Crop, climate: ClimateData, opts: ScoreOptions): CropRecommendation | null {
  const evals = Array.from({ length: 12 }, (_, i) => evaluateMonth(crop, i + 1, climate, opts));
  const valid = evals.filter((e): e is MonthEvaluation => e !== null);
  if (!valid.length) return null;

  const best = valid.reduce((a, b) => (b.score > a.score ? b : a));
  const { reasons, warnings } = explain(crop, best, opts);
  const score = round(best.score * 100);
  const harvestMonth = ((best.month - 1 + Math.round((15 + crop.seasonDays) / 30.4)) % 12) + 1;

  return {
    cropId: crop.id,
    crop: crop.name,
    score,
    risk: best.weightedSuccess >= 0.8 && score >= 75 ? 'low' : best.weightedSuccess >= 0.6 && score >= 55 ? 'medium' : 'high',
    droughtTolerance: crop.droughtTolerance,
    plantingMonth: best.month,
    plantingMonthName: MONTH_NAMES[best.month - 1],
    harvestMonthName: MONTH_NAMES[harvestMonth - 1],
    goodPlantingMonths: valid.filter((e) => e.score >= best.score - 0.05 && e.score >= 0.5).map((e) => MONTH_NAMES[e.month - 1]),
    monthScores: evals.map((e) => (e ? round(e.score * 100) : 0)),
    successYears: best.successYears,
    totalYears: best.seasons.length,
    expected: best.expected,
    scoreBreakdown: best.parts,
    reasons,
    warnings,
  };
}

export function rankCrops(climate: ClimateData, opts: ScoreOptions): CropRecommendation[] {
  return CROPS.map((c) => scoreCrop(c, climate, opts))
    .filter((r): r is CropRecommendation => r !== null)
    .sort((a, b) => b.score - a.score);
}
