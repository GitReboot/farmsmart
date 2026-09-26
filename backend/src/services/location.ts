import { SSA_COUNTRIES, toSsaCountryCode } from '../data/countries.js';
import { HttpError } from '../lib/errors.js';
import { geocode, type Place } from './openMeteo.js';

export interface ResolvedLocation {
  name: string;
  admin1?: string;
  country: string;
  countryCode: string;
  /** Rounded to 0.1° (~11 km): enough for ~25 km climate data, and avoids pinpointing a farm. */
  lat: number;
  lon: number;
  elevationM?: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function toResolved(p: Place): ResolvedLocation {
  return {
    name: p.name,
    admin1: p.admin1,
    country: p.country,
    countryCode: p.countryCode,
    lat: round1(p.lat),
    lon: round1(p.lon),
    elevationM: p.elevationM,
  };
}

/** Turn the farmer's "city, country" input into coordinates. Restricted to Sub-Saharan Africa. */
export async function resolveLocation(city: string, country: string) {
  const countryCode = toSsaCountryCode(country);
  if (!countryCode) {
    throw new HttpError(422, 'UNSUPPORTED_COUNTRY', `FarmSmart currently supports Sub-Saharan African countries only; "${country}" was not recognised.`, {
      supportedCountries: Object.values(SSA_COUNTRIES).map((names) => names[0]),
    });
  }

  const places = await geocode(city, countryCode, 5);
  if (!places.length) {
    throw new HttpError(404, 'LOCATION_NOT_FOUND', `Could not find "${city}" in ${SSA_COUNTRIES[countryCode][0]}. Try a nearby town or check the spelling.`);
  }

  // Open-Meteo returns results ranked by relevance/population; take the best match.
  const [best, ...rest] = places;
  return {
    location: toResolved(best),
    alternatives: rest.map((p) => ({ name: p.name, admin1: p.admin1, country: p.country })),
  };
}
