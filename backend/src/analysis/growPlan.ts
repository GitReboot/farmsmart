import type { Crop } from '../data/crops.js';
import type { ClimateProfile } from './climate.js';
import type { CropRecommendation } from './cropScoring.js';

export const STAGE_IDS = ['land_prep', 'planting', 'early_growth', 'critical', 'maturity', 'harvest'] as const;
export type StageId = (typeof STAGE_IDS)[number];

export interface Stage {
  id: StageId;
  name: string;
  startDate: string;
  endDate: string;
  /** Expected climate over the stage, from the recency-weighted 20-year profile. */
  climate: { rainMm: number; tmaxC: number; heatDays: number; waterBalanceMm: number };
  tips: string[];
}

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Next mid-month planting date on or after today. */
function nextPlantingDate(month: number, now = new Date()): number {
  const y = now.getUTCFullYear();
  const thisYear = Date.UTC(y, month - 1, 15);
  return thisYear >= now.getTime() ? thisYear : Date.UTC(y + 1, month - 1, 15);
}

function stageClimate(profile: ClimateProfile, start: number, end: number): Stage['climate'] {
  let rain = 0;
  let et0 = 0;
  let heat = 0;
  let tmax = 0;
  let days = 0;
  for (let t = start; t <= end; t += DAY) {
    const m = profile.monthly[new Date(t).getUTCMonth()];
    const dim = new Date(Date.UTC(new Date(t).getUTCFullYear(), m.month, 0)).getUTCDate();
    rain += m.rainMm.expected / dim;
    et0 += m.et0Mm / dim;
    heat += m.heatDays / dim;
    tmax += m.tmaxC;
    days++;
  }
  return { rainMm: Math.round(rain), tmaxC: Math.round((tmax / days) * 10) / 10, heatDays: Math.round(heat), waterBalanceMm: Math.round(rain - et0) };
}

/** Deterministic stage timeline — dates and climate numbers never come from the LLM. */
export function buildStages(crop: Crop, plantingMonth: number, profile: ClimateProfile): Stage[] {
  const plant = nextPlantingDate(plantingMonth);
  const len = crop.seasonDays;
  const cs = plant + Math.floor(len * crop.critical.window[0]) * DAY;
  const ce = plant + Math.floor(len * crop.critical.window[1]) * DAY;
  const end = plant + len * DAY;
  const defs: [StageId, string, number, number][] = [
    ['land_prep', 'Land preparation', plant - 21 * DAY, plant - DAY],
    ['planting', 'Planting & emergence', plant, plant + 14 * DAY],
    ['early_growth', 'Early growth', plant + 15 * DAY, cs - DAY],
    ['critical', `Critical stage: ${crop.critical.name}`, cs, ce],
    ['maturity', 'Maturity', ce + DAY, end],
    ['harvest', 'Harvest & storage', end + DAY, end + 14 * DAY],
  ];
  return defs.map(([id, name, s, e]) => ({ id, name, startDate: iso(s), endDate: iso(e), climate: stageClimate(profile, s, e), tips: [] }));
}

/** Rule-based tips used when the LLM is unavailable (no key, timeout, or invalid output). */
export function templateTips(crop: Crop, stage: Stage, rec: CropRecommendation, irrigation: boolean): string[] {
  const c = stage.climate;
  const dryNote = c.waterBalanceMm < -30 ? (irrigation ? `Plan to irrigate: expected water shortfall ~${-c.waterBalanceMm} mm in this stage.` : `Expect a water shortfall (~${-c.waterBalanceMm} mm); mulch to keep soil moisture.`) : null;
  const heatNote = c.heatDays >= 2 ? `About ${c.heatDays} very hot days expected; water early morning.` : null;
  const tips: Record<StageId, string[]> = {
    land_prep: ['Clear the field and dig in compost or manure before the rains.', rec.expected.seasonRainMm > crop.rainOpt[1] ? 'Make ridges or raised beds so water drains.' : 'Prepare planting basins or tied ridges to hold rain water.'],
    planting: [`Plant ${crop.name.toLowerCase()} once the soil is moist to about a hand's depth (after ~20 mm of rain).`, 'Use certified seed of a locally recommended variety.'],
    early_growth: ['Weed at 2–3 weeks and again at 5–6 weeks after planting.', 'Scout weekly for pests on the underside of leaves.'],
    critical: [`${crop.critical.name[0].toUpperCase()}${crop.critical.name.slice(1)} is the most water-sensitive stage; do not let the soil dry out.`],
    maturity: ['Reduce watering as the crop dries down.', 'Keep scouting for pests and birds.'],
    harvest: ['Harvest in dry weather and dry the produce well before storage.', 'Store in clean, airtight bags to prevent mould and pests.'],
  };
  return [...tips[stage.id], dryNote, heatNote].filter((t): t is string => !!t);
}
