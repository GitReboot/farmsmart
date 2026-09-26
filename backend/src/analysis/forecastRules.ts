import type { Crop } from '../data/crops.js';
import { round } from '../lib/stats.js';
import { FORECAST_PAST_DAYS, type ForecastData } from '../services/openMeteo.js';

export type ActionType = 'heavy_rain' | 'frost' | 'heat_stress' | 'skip_irrigation' | 'irrigate' | 'disease_risk' | 'spray_window' | 'normal';
export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Action {
  type: ActionType;
  severity: Severity;
  title: string;
  detail: string;
  /** Which rule fired and on what numbers — shown in the "Why?" panel. */
  why: string;
}

export interface ForecastDay {
  date: string;
  weekday: string;
  tmaxC: number;
  tminC: number;
  rainMm: number;
  rainChancePct: number | null;
  windKmh: number;
  confidence: 'high' | 'medium' | 'low';
  actions: Action[];
  primary: Action;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
const DEFICIT_TRIGGER_MM = 25;

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

export function buildActionCard(fc: ForecastData, crop: Crop) {
  const d = fc.daily;
  const n = d.time.length;
  const rainLikely = (i: number) => i < n && d.precipitation_sum[i] >= 5 && (d.precipitation_probability_max[i] ?? 100) >= 60;

  // Hours per day that are humid and mild enough for fungal disease (blight, rust).
  const humidHours = new Map<string, number>();
  fc.hourly.time.forEach((t, i) => {
    const rh = fc.hourly.relative_humidity_2m[i];
    const temp = fc.hourly.temperature_2m[i];
    if (rh >= 90 && temp >= 15 && temp <= 25) humidHours.set(t.slice(0, 10), (humidHours.get(t.slice(0, 10)) ?? 0) + 1);
  });

  // Simple water balance: deficit grows by crop water use, shrinks with effective rain.
  let deficit = 0;
  for (let i = 0; i < FORECAST_PAST_DAYS; i++) deficit = Math.max(0, deficit + d.et0_fao_evapotranspiration[i] * crop.kc - 0.8 * d.precipitation_sum[i]);
  const recentRainMm = round(d.precipitation_sum.slice(0, FORECAST_PAST_DAYS).reduce((a, b) => a + b, 0), 1);

  const days: ForecastDay[] = [];
  for (let i = FORECAST_PAST_DAYS; i < n; i++) {
    const date = d.time[i];
    const tmax = d.temperature_2m_max[i];
    const tmin = d.temperature_2m_min[i];
    const rain = d.precipitation_sum[i];
    const chance = d.precipitation_probability_max[i];
    const wind = d.wind_speed_10m_max[i];
    const day = weekday(date);
    const actions: Action[] = [];

    if (rain >= 30) {
      actions.push({ type: 'heavy_rain', severity: 'high', title: 'Heavy rain', detail: `Clear drainage channels and hold off on fertilizer until after ${day}.`, why: `${round(rain)} mm forecast (threshold 30 mm).` });
    }
    if (crop.frostSensitive && tmin <= 2) {
      actions.push({ type: 'frost', severity: 'high', title: 'Frost risk', detail: 'Cover seedlings tonight and water the soil in the evening to hold heat.', why: `Low of ${round(tmin, 1)}°C (threshold 2°C).` });
    }
    if (tmax >= crop.heatStressC) {
      actions.push({ type: 'heat_stress', severity: 'high', title: 'Heat stress risk', detail: 'Water early in the morning, mulch the soil, and avoid field work at midday.', why: `High of ${round(tmax, 1)}°C (${crop.name} is stressed above ${crop.heatStressC}°C).` });
    }

    const rainSoon = rainLikely(i) || rainLikely(i + 1);
    deficit = Math.max(0, deficit + d.et0_fao_evapotranspiration[i] * crop.kc - 0.8 * rain);
    if (rainSoon) {
      const rainDay = rainLikely(i) ? i : i + 1;
      actions.push({
        type: 'skip_irrigation',
        severity: 'medium',
        title: 'Delay irrigation',
        detail: `Rain expected ${rainDay === i ? 'today' : weekday(d.time[rainDay])} (${round(d.precipitation_sum[rainDay])} mm). Save water and fuel.`,
        why: `${round(d.precipitation_sum[rainDay])} mm at ${d.precipitation_probability_max[rainDay] ?? '?'}% chance (threshold 5 mm at 60%).`,
      });
    } else if (deficit >= DEFICIT_TRIGGER_MM) {
      actions.push({
        type: 'irrigate',
        severity: 'medium',
        title: 'Irrigate',
        detail: `Apply about ${round(deficit)} mm of water, ideally early morning. No significant rain in the next 2 days.`,
        why: `Crop water use has exceeded rain by ${round(deficit)} mm (trigger ${DEFICIT_TRIGGER_MM} mm).`,
      });
      deficit = 0;
    }

    const hh = humidHours.get(date) ?? 0;
    if (hh >= 10) {
      actions.push({ type: 'disease_risk', severity: 'medium', title: 'Fungal disease risk', detail: 'Check leaves for spots or mould; improve air flow and avoid wetting leaves.', why: `${hh} hours of humidity ≥90% at 15–25°C (threshold 10 hours).` });
    }
    if (wind < 20 && rain < 1 && (chance ?? 0) < 30 && !rainLikely(i + 1)) {
      actions.push({ type: 'spray_window', severity: 'low', title: 'Good day to spray', detail: 'Calm and dry: a good window for pesticide or foliar feed.', why: `Wind ${round(wind)} km/h (<20), rain chance ${chance ?? 0}% (<30%).` });
    }
    if (!actions.length) {
      actions.push({ type: 'normal', severity: 'info', title: 'Normal field day', detail: 'No weather risks. Continue weeding and scouting as usual.', why: 'No rule thresholds reached.' });
    }

    actions.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    const offset = i - FORECAST_PAST_DAYS;
    days.push({
      date,
      weekday: day,
      tmaxC: round(tmax, 1),
      tminC: round(tmin, 1),
      rainMm: round(rain, 1),
      rainChancePct: chance,
      windKmh: round(wind),
      confidence: offset <= 2 ? 'high' : offset <= 4 ? 'medium' : 'low',
      actions,
      primary: actions[0],
    });
  }

  // Headline: first occurrence of each non-routine action type, most severe first.
  const seen = new Set<ActionType>();
  const headline: (Action & { date: string; weekday: string })[] = [];
  for (const day of days) {
    for (const a of day.actions) {
      if (a.type === 'normal' || a.type === 'spray_window' || seen.has(a.type)) continue;
      seen.add(a.type);
      headline.push({ ...a, date: day.date, weekday: day.weekday });
    }
  }
  headline.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const top = headline.slice(0, 3);

  const sms = top.length
    ? `FarmSmart ${crop.name}: ` + top.map((a) => `${a.title} ${a.weekday.slice(0, 3)}`).join('; ') + '.'
    : `FarmSmart ${crop.name}: No weather risks this week. Continue normal field work.`;

  return {
    headline: top,
    days,
    recentRainMm,
    smsText: sms.slice(0, 160),
  };
}
