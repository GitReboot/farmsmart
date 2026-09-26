# FarmSmart 🌱

Climate-informed crop advice for smallholder farmers in **Sub-Saharan Africa**.
A farmer enters their town and country. FarmSmart analyses **20 years of weather history**, weighting the most recent years more, and returns:

- **Which crops to grow**, ranked, with the best planting month and "worked in 17 of 20 seasons"
- **How to grow it**: a stage-by-stage plan in the farmer's language (Swahili, Hausa, Amharic, French…)
- **What to do this week**: a 7-day action card such as "Delay irrigation, rain expected Thursday"

Built for the AI Collective Hack for Humanity.

## Repo layout

```
farmsmart/
├── backend/     Node + Express + TypeScript API          (port 4000)
├── frontend/    Next.js app                               (port 3000)
└── docs/API.md  API contract between the two  ← frontend: start here
```

## Run the backend

```bash
cd backend
cp .env.example .env        # add OPENAI_API_KEY (optional; without it the plan uses rule-based tips)
npm install
npm run dev                 # http://localhost:4000/api/health
```

Try it:
```bash
curl -X POST http://localhost:4000/api/analyze -H "Content-Type: application/json" \
  -d '{"city":"Nakuru","country":"Kenya"}'
```

`npm run warm` pre-downloads history for the demo cities (see `backend/scripts/warm.ts`). Open-Meteo's free tier only allows a few *new* 20-year downloads per minute. Cached cities are instant and are committed in `backend/.cache/`.

## Connecting the frontend (Next.js)

**Option A (recommended): proxy through Next.js.** There are no CORS issues, and the frontend just calls `/api/...`.

`frontend/next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/api/:path*` }];
  },
};
export default nextConfig;
```
(Don't create Next.js API routes under `app/api/` with the same names, or they'll take priority over the rewrite.)

`frontend/lib/api.ts`:
```ts
export async function farmsmart<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? 'Something went wrong');
  return data as T;
}

// usage
const result = await farmsmart('analyze', { city: 'Nakuru', country: 'Kenya', irrigation: false });
const plan = await farmsmart('grow-plan', { city: 'Nakuru', country: 'Kenya', crop: 'common_bean', language: 'sw' });
```

**Option B: call the backend directly.** Set `NEXT_PUBLIC_API_URL=http://localhost:4000` and use `${process.env.NEXT_PUBLIC_API_URL}/api/...`. The backend allows CORS from the origins listed in `ALLOWED_ORIGINS`.

## Running the demo locally

Use two terminals:
```bash
cd backend && npm run dev     # http://localhost:4000
cd frontend && npm run dev    # http://localhost:3000
```
Open http://localhost:3000. If both run on the same machine, no extra config is needed.

## How it works

```
city + country ──► Open-Meteo Geocoding ──► lat/lon (rounded to ~11 km)
                                              │
            ┌─────────────────────────────────┼─────────────────────────┐
            ▼                                 ▼                         ▼
  Open-Meteo ERA5 (20 yrs daily)       ISRIC SoilGrids (pH, texture)   Open-Meteo 7-day forecast
            │                                 │                         │
            ▼                                 │                         ▼
  Climate profile (recency-weighted,          │                  Rules engine → action card
  half-life 5 yrs; trends; seasons)           │
            │                                 │
            ▼                                 ▼
  Crop scoring: replay each planting month against all 20 past seasons
  (temperature fit, rain vs crop water need ET0×Kc, heat/dry-spell stress, soil pH)
            │
            ▼
  Growing plan: dates + numbers computed by us  ──►  OpenAI writes tips in the farmer's language
                                                     (validated JSON; rule-based fallback)
```

### Responsible design
- **Deterministic core.** Rankings, dates and weather numbers come from transparent rules. The LLM never produces a number.
- **No free text reaches the LLM.** Only validated crop IDs, language codes and our computed values are sent.
- **LLM output is schema-validated** (OpenAI Structured Outputs + Zod). If it's invalid or unavailable, we fall back to rule-based tips.
- **Privacy.** No accounts and no database. Coordinates are rounded to 0.1° (about 11 km). Logs never contain locations.
- **Honest uncertainty.** We show ranges (p10–p90) and "worked in X of 20 seasons", fade low-confidence forecast days, and include a disclaimer on every response.
- **Abuse protection.** Rate limits (with a tighter limit on the LLM route), a 10 KB body limit, helmet headers and a CORS allowlist.

### Data sources
- [Open-Meteo](https://open-meteo.com): Geocoding, Historical Weather (ERA5 reanalysis), Forecast. Free, no key, non-commercial use.
- [ISRIC SoilGrids](https://www.isric.org/explore/soilgrids): soil properties
- Crop requirements are approximated from FAO ECOCROP and FAO-56 crop coefficients
