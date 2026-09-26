/**
 * Pre-download 20-year history for demo locations into .cache/history so the
 * live demo never waits on (or gets rate-limited by) Open-Meteo.
 *
 *   npm run warm                         # default demo cities
 *   npm run warm -- "Gulu,Uganda" "Tamale,Ghana"
 */
import { resolveLocation } from '../src/services/location.js';
import { fetchHistory } from '../src/services/openMeteo.js';
import { UpstreamError } from '../src/lib/errors.js';

const DEFAULT_CITIES = [
  'Nakuru,Kenya',
  'Kitui,Kenya',
  'Kano,Nigeria',
  'Tamale,Ghana',
  'Kumasi,Ghana',
  'Bulawayo,Zimbabwe',
  'Addis Ababa,Ethiopia',
  'Dodoma,Tanzania',
  'Gulu,Uganda',
  'Lilongwe,Malawi',
  'Kaolack,Senegal',
  'Musanze,Rwanda',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cities = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CITIES;

for (const entry of cities) {
  const [city, country] = entry.split(',').map((s) => s.trim());
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { location } = await resolveLocation(city, country);
      const t = Date.now();
      const h = await fetchHistory(location.lat, location.lon);
      const took = Date.now() - t;
      console.log(`✓ ${city}, ${country} (${location.lat}, ${location.lon}) — ${h.time.length} days${took < 200 ? ' [already cached]' : ''}`);
      if (took >= 200) await sleep(20_000); // stay under the free per-minute limit
      break;
    } catch (err) {
      if (err instanceof UpstreamError && err.rateLimited && attempt < 3) {
        console.log(`  rate limited, waiting 65s…`);
        await sleep(65_000);
        continue;
      }
      console.log(`✗ ${city}, ${country}: ${err instanceof Error ? err.message : err}`);
      break;
    }
  }
}
