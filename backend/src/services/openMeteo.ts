import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { cached, HOUR } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';

// Free, no-key APIs from https://open-meteo.com (non-commercial use).
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

export interface Place {
  name: string;
  admin1?: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  elevationM?: number;
  population?: number;
}

interface GeocodeResponse {
  results?: {
    name: string;
    latitude: number;
    longitude: number;
    elevation?: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    population?: number;
  }[];
}

export async function geocode(name: string, countryCode?: string, count = 5): Promise<Place[]> {
  const params = new URLSearchParams({ name, count: String(count), language: 'en', format: 'json' });
  if (countryCode) params.set('countryCode', countryCode);
  const key = `geo:${params}`;
  const { places } = await cached(key, 24 * HOUR, async () => {
    const data = await fetchJson<GeocodeResponse>(`${GEOCODE_URL}?${params}`, 'Open-Meteo Geocoding', 8000);
    const places: Place[] = (data.results ?? []).map((r) => ({
      name: r.name,
      admin1: r.admin1,
      country: r.country ?? '',
      countryCode: r.country_code ?? '',
      lat: r.latitude,
      lon: r.longitude,
      elevationM: r.elevation,
      population: r.population,
    }));
    return { places };
  });
  return places;
}

export interface DailyHistory {
  time: string[];
  tmax: (number | null)[];
  tmin: (number | null)[];
  precip: (number | null)[];
  et0: (number | null)[];
}

interface ArchiveResponse {
  daily: {
    time: string[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_sum: (number | null)[];
    et0_fao_evapotranspiration: (number | null)[];
  };
}

export type History = DailyHistory & { startYear: number; endYear: number };

// Historical data never changes, so keep it on disk. Open-Meteo weights a 20-year request as many
// API calls, and the free tier's per-minute limit is hit after a few new locations.
const DISK_CACHE_DIR = path.resolve(process.cwd(), '.cache', 'history');

/** Daily ERA5 reanalysis for the last N full calendar years (disk-cached). */
export async function fetchHistory(lat: number, lon: number): Promise<History> {
  const endYear = new Date().getUTCFullYear() - 1;
  const startYear = endYear - config.historyYears + 1;
  const file = path.join(DISK_CACHE_DIR, `era5_${lat}_${lon}_${startYear}-${endYear}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as History;
  } catch {
    // not cached yet
  }
  const history = await downloadHistory(lat, lon, startYear, endYear);
  await mkdir(DISK_CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(history));
  return history;
}

async function downloadHistory(lat: number, lon: number, startYear: number, endYear: number): Promise<History> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: `${startYear}-01-01`,
    end_date: `${endYear}-12-31`,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration',
    // ERA5 only: the default "best_match" blends in a higher-resolution model from 2017, which creates a fake climate shift.
    models: 'era5',
    timezone: 'auto',
  });
  const data = await fetchJson<ArchiveResponse>(`${ARCHIVE_URL}?${params}`, 'Open-Meteo Historical', 30000);
  const d = data.daily;
  return {
    startYear,
    endYear,
    time: d.time,
    tmax: d.temperature_2m_max,
    tmin: d.temperature_2m_min,
    precip: d.precipitation_sum,
    et0: d.et0_fao_evapotranspiration,
  };
}

export interface ForecastData {
  timezone: string;
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: (number | null)[];
    et0_fao_evapotranspiration: number[];
    wind_speed_10m_max: number[];
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
  };
}

export const FORECAST_PAST_DAYS = 3;

export async function fetchForecast(lat: number, lon: number): Promise<ForecastData> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily:
      'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max',
    hourly: 'temperature_2m,relative_humidity_2m',
    past_days: String(FORECAST_PAST_DAYS),
    forecast_days: '7',
    timezone: 'auto',
  });
  return cached(`fc:${lat},${lon}`, 1 * HOUR, () =>
    fetchJson<ForecastData>(`${FORECAST_URL}?${params}`, 'Open-Meteo Forecast', 10000),
  );
}
