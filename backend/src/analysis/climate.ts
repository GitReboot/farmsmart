import { cached, HOUR } from '../lib/cache.js';
import { mean, percentile, round, slope, stdev, sum, weightedMean } from '../lib/stats.js';
import { fetchHistory } from '../services/openMeteo.js';

/**
 * Recency weighting: a year's weight halves every HALF_LIFE_YEARS, so the last
 * ~3 years count for far more than 2006 does, but older years still anchor the
 * estimate (a single odd year can't swing it).
 */
export const HALF_LIFE_YEARS = 5;
export const RECENT_YEARS = 3;
export const HEAT_DAY_C = 35;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

export interface DayRecord {
  date: string;
  year: number;
  month: number;
  tmax: number;
  tmin: number;
  tmean: number;
  rain: number;
  et0: number;
}

export interface ClimateData {
  records: DayRecord[];
  dateIndex: Map<string, number>;
  startYear: number;
  endYear: number;
  profile: ClimateProfile;
}

export const yearWeight = (year: number, endYear: number) => 0.5 ** ((endYear - year) / HALF_LIFE_YEARS);

interface Range {
  expected: number;
  p10: number;
  p90: number;
  longTermAvg: number;
  recentAvg: number;
}

export interface MonthClimate {
  month: number;
  name: string;
  rainMm: Range;
  tmaxC: number;
  tminC: number;
  heatDays: number;
  et0Mm: number;
  waterBalanceMm: number;
  growingMonth: boolean;
}

export interface ClimateProfile {
  period: { startYear: number; endYear: number; years: number };
  method: { weighting: 'exponential-decay'; halfLifeYears: number; recentYears: number; source: string };
  annual: { rainMm: Range; meanTempC: { expected: number; longTermAvg: number; recentAvg: number }; rainVariabilityPct: number };
  recentVsLongTerm: { recentPeriod: string; comparePeriod: string; rainPct: number; tempC: number };
  trendPerDecade: { rainPct: number; tempC: number };
  monthly: MonthClimate[];
  growingSeasons: { label: string; months: number[] }[];
  insights: string[];
}

function toRecords(h: Awaited<ReturnType<typeof fetchHistory>>): DayRecord[] {
  const out: DayRecord[] = [];
  let lastMax = 25;
  let lastMin = 15;
  for (let i = 0; i < h.time.length; i++) {
    const tmax = h.tmax[i] ?? lastMax;
    const tmin = h.tmin[i] ?? lastMin;
    lastMax = tmax;
    lastMin = tmin;
    const date = h.time[i];
    out.push({
      date,
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(5, 7)),
      tmax,
      tmin,
      tmean: (tmax + tmin) / 2,
      rain: h.precip[i] ?? 0,
      et0: h.et0[i] ?? 0,
    });
  }
  return out;
}

function range(values: number[], years: number[], endYear: number, digits = 0): Range {
  const ws = years.map((y) => yearWeight(y, endYear));
  const recent = values.filter((_, i) => years[i] > endYear - RECENT_YEARS);
  return {
    expected: round(weightedMean(values, ws), digits),
    p10: round(percentile(values, 10), digits),
    p90: round(percentile(values, 90), digits),
    longTermAvg: round(mean(values), digits),
    recentAvg: round(mean(recent), digits),
  };
}

/** Runs of consecutive growing months, wrapping around the year (e.g. Nov–Feb). */
function findSeasons(growing: boolean[]): { label: string; months: number[] }[] {
  if (growing.every(Boolean)) return [{ label: 'Year-round', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }];
  const firstDry = growing.indexOf(false);
  if (firstDry < 0) return [];
  const seasons: number[][] = [];
  let run: number[] = [];
  for (let k = 1; k <= 12; k++) {
    const m = (firstDry + k) % 12;
    if (growing[m]) run.push(m + 1);
    else if (run.length) {
      seasons.push(run);
      run = [];
    }
  }
  if (run.length) seasons.push(run);
  return seasons.map((months) => ({
    label: months.length === 1 ? MONTH_NAMES[months[0] - 1] : `${SHORT[months[0] - 1]}–${SHORT[months[months.length - 1] - 1]}`,
    months,
  }));
}

function buildProfile(records: DayRecord[], startYear: number, endYear: number): ClimateProfile {
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

  // Aggregate per (year, month).
  type Agg = { rain: number; et0: number; tmax: number[]; tmin: number[]; heat: number };
  const agg = new Map<string, Agg>();
  for (const r of records) {
    const key = `${r.year}-${r.month}`;
    let a = agg.get(key);
    if (!a) agg.set(key, (a = { rain: 0, et0: 0, tmax: [], tmin: [], heat: 0 }));
    a.rain += r.rain;
    a.et0 += r.et0;
    a.tmax.push(r.tmax);
    a.tmin.push(r.tmin);
    if (r.tmax >= HEAT_DAY_C) a.heat++;
  }

  const ws = years.map((y) => yearWeight(y, endYear));
  const monthly: MonthClimate[] = MONTH_NAMES.map((name, i) => {
    const m = i + 1;
    const rows = years.map((y) => agg.get(`${y}-${m}`)!);
    const rain = range(rows.map((a) => a.rain), years, endYear);
    const et0 = weightedMean(rows.map((a) => a.et0), ws);
    return {
      month: m,
      name,
      rainMm: rain,
      tmaxC: round(weightedMean(rows.map((a) => mean(a.tmax)), ws), 1),
      tminC: round(weightedMean(rows.map((a) => mean(a.tmin)), ws), 1),
      heatDays: round(weightedMean(rows.map((a) => a.heat), ws), 1),
      et0Mm: round(et0),
      waterBalanceMm: round(rain.expected - et0),
      // FAO length-of-growing-period rule of thumb: rain covers at least half of ET0.
      growingMonth: rain.expected >= 0.5 * et0,
    };
  });

  const annualRain = years.map((y) => sum(MONTH_NAMES.map((_, i) => agg.get(`${y}-${i + 1}`)!.rain)));
  const annualTemp = years.map((y) => mean(records.filter((r) => r.year === y).map((r) => r.tmean)));
  const isRecent = (y: number) => y > endYear - RECENT_YEARS;
  const recentRain = mean(annualRain.filter((_, i) => isRecent(years[i])));
  const earlierRain = mean(annualRain.filter((_, i) => !isRecent(years[i])));
  const recentTemp = mean(annualTemp.filter((_, i) => isRecent(years[i])));
  const earlierTemp = mean(annualTemp.filter((_, i) => !isRecent(years[i])));

  const rainPct = earlierRain ? ((recentRain - earlierRain) / earlierRain) * 100 : 0;
  const tempC = recentTemp - earlierTemp;
  const rainTrend = mean(annualRain) ? ((slope(years, annualRain) * 10) / mean(annualRain)) * 100 : 0;
  const tempTrend = slope(years, annualTemp) * 10;
  const variability = mean(annualRain) ? (stdev(annualRain) / mean(annualRain)) * 100 : 0;
  const growingSeasons = findSeasons(monthly.map((m) => m.growingMonth));

  const recentPeriod = `${endYear - RECENT_YEARS + 1}–${endYear}`;
  const comparePeriod = `${startYear}–${endYear - RECENT_YEARS}`;

  const insights: string[] = [];
  if (Math.abs(rainPct) >= 5) {
    insights.push(`The last ${RECENT_YEARS} years (${recentPeriod}) were ${Math.abs(round(rainPct))}% ${rainPct < 0 ? 'drier' : 'wetter'} than ${comparePeriod}.`);
  } else {
    insights.push(`Rainfall in the last ${RECENT_YEARS} years has been close to the long-term average.`);
  }
  if (tempTrend >= 0.1) insights.push(`Temperatures are rising about ${tempTrend.toFixed(1)}°C per decade.`);
  if (growingSeasons.length === 0) insights.push('No month reliably gets enough rain for rain-fed crops; plan for irrigation.');
  else if (growingSeasons.length >= 2) insights.push(`This area has ${growingSeasons.length} rainy seasons: ${growingSeasons.map((s) => s.label).join(' and ')}.`);
  else insights.push(`Main growing season: ${growingSeasons[0].label}.`);
  if (variability >= 25) insights.push(`Rainfall changes a lot from year to year (±${round(variability)}%), so drought-tolerant crops lower the risk.`);
  const hotMonths = monthly.filter((m) => m.heatDays >= 5).map((m) => SHORT[m.month - 1]);
  if (hotMonths.length) insights.push(`Frequent days above ${HEAT_DAY_C}°C in ${hotMonths.join(', ')}.`);

  return {
    period: { startYear, endYear, years: years.length },
    method: { weighting: 'exponential-decay', halfLifeYears: HALF_LIFE_YEARS, recentYears: RECENT_YEARS, source: 'Open-Meteo ERA5 reanalysis' },
    annual: {
      rainMm: range(annualRain, years, endYear),
      meanTempC: { expected: round(weightedMean(annualTemp, ws), 1), longTermAvg: round(mean(annualTemp), 1), recentAvg: round(recentTemp, 1) },
      rainVariabilityPct: round(variability),
    },
    recentVsLongTerm: { recentPeriod, comparePeriod, rainPct: round(rainPct), tempC: round(tempC, 1) },
    trendPerDecade: { rainPct: round(rainTrend), tempC: round(tempTrend, 2) },
    monthly,
    growingSeasons,
    insights,
  };
}

/** Fetch and analyse 20 years of history for a (rounded) coordinate. Cached for 24h. */
export function getClimate(lat: number, lon: number): Promise<ClimateData> {
  return cached(`climate:${lat},${lon}`, 24 * HOUR, async () => {
    const h = await fetchHistory(lat, lon);
    const records = toRecords(h);
    const dateIndex = new Map(records.map((r, i) => [r.date, i]));
    return { records, dateIndex, startYear: h.startYear, endYear: h.endYear, profile: buildProfile(records, h.startYear, h.endYear) };
  });
}
