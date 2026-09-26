# FarmSmart API

Base URL
- Local: `http://localhost:4000/api`


All main endpoints are **`POST` with a JSON body**. The frontend sends what the farmer typed (`city` + `country`) and the backend handles geocoding. Only **Sub-Saharan African** countries are supported.

## Endpoints at a glance

| Endpoint | Use it for | Speed |
|---|---|---|
| `POST /api/analyze` | **Main results screen**: climate + top crops + this week's action card, in one call | 0.5–4 s first time for a city, then ~10 ms |
| `POST /api/recommend` | Crop ranking only | same |
| `POST /api/climate` | Climate charts only | same |
| `POST /api/forecast` | 7-day action card for a chosen crop | ~0.5 s |
| `POST /api/grow-plan` | Step-by-step growing plan for one crop (uses OpenAI) | 3–10 s, **show a spinner** |
| `GET /api/crops` | Crop list for a picker | instant |
| `GET /api/languages` | Language list for a picker | instant |
| `GET /api/health` | Is the API up? Is the LLM configured? | instant |

## Suggested UI flow

1. **Form:** city (text), country (text or dropdown), "I can irrigate" toggle, language
2. `POST /api/analyze`, then render the climate snapshot, the top-5 crop cards and the "This week" card
3. Farmer taps a crop: `POST /api/grow-plan` with `crop` = that card's `cropId`
4. Optional: crop picker on the "This week" card, which calls `POST /api/forecast` with `crop`

---

## `POST /api/analyze`

```json
{ "city": "Nakuru", "country": "Kenya", "irrigation": false }
```
| field | type | required | notes |
|---|---|---|---|
| `city` | string | yes | 1–100 chars |
| `country` | string | yes | name or ISO code: `"Kenya"`, `"KE"`, `"Ivory Coast"`… |
| `irrigation` | boolean | no (false) | farmer has access to irrigation |
| `crop` | crop id | no | crop for the "This week" card (default: top-ranked crop) |

Response (trimmed):
```jsonc
{
  "location": { "name": "Nakuru", "admin1": "Nakuru County", "country": "Kenya", "countryCode": "KE", "lat": -0.3, "lon": 36.1, "elevationM": 1802 },
  "alternatives": [{ "name": "Nakuru South", "admin1": "Nakuru County", "country": "Kenya" }],   // "Did you mean…?"
  "soil": { "ph": 6.3, "clayPct": 41.7, "sandPct": 36.4, "organicCarbonGPerKg": 24.1, "texture": "clay", "depth": "0-30cm" }, // may be null
  "climate": {
    "period": { "startYear": 2006, "endYear": 2025, "years": 20 },
    "method": { "weighting": "exponential-decay", "halfLifeYears": 5, "recentYears": 3, "source": "Open-Meteo ERA5 reanalysis" },
    "annual": {
      "rainMm": { "expected": 790, "p10": 520, "p90": 1070, "longTermAvg": 754, "recentAvg": 779 },
      "meanTempC": { "expected": 19.8, "longTermAvg": 19.4, "recentAvg": 20.1 },
      "rainVariabilityPct": 28
    },
    "recentVsLongTerm": { "recentPeriod": "2023–2025", "comparePeriod": "2006–2022", "rainPct": 4, "tempC": 0.9 },
    "trendPerDecade": { "rainPct": 3, "tempC": 0.4 },
    "monthly": [   // 12 items, Jan..Dec -> bar/line charts
      { "month": 1, "name": "January",
        "rainMm": { "expected": 40, "p10": 5, "p90": 90, "longTermAvg": 38, "recentAvg": 45 },
        "tmaxC": 27.9, "tminC": 11.2, "heatDays": 0, "et0Mm": 130, "waterBalanceMm": -90, "growingMonth": false }
    ],
    "growingSeasons": [{ "label": "Mar–May", "months": [3, 4, 5] }],
    "insights": ["Temperatures are rising about 0.4°C per decade.", "..."]   // plain-language, show as bullet list
  },
  "recommendations": [   // top 5, best first
    {
      "cropId": "common_bean", "crop": "Common bean",
      "score": 79,                          // 0-100
      "risk": "medium",                     // low | medium | high  -> green / amber / red
      "droughtTolerance": "low",
      "plantingMonth": 3, "plantingMonthName": "March", "harvestMonthName": "June",
      "goodPlantingMonths": ["March", "April"],
      "monthScores": [20, 35, 79, 76, 40, 0, 0, 30, 45, 60, 55, 25],   // Jan..Dec -> planting-calendar heatmap
      "successYears": 12, "totalYears": 20,                            // "Worked in 12 of 20 seasons"
      "expected": { "seasonRainMm": 276, "meanTempC": 19.7, "heatStressDays": 0, "frostDays": 0, "drySpellDays": 5, "irrigationNeedMm": 90 },
      "scoreBreakdown": { "temperature": 0.9, "water": 0.8, "reliability": 0.6, "soil": 1 },
      "reasons": ["Worked in 12 of the last 20 seasons when planted mid-March.", "..."],
      "warnings": ["Rain is usually below what this crop needs; expect a shortfall of ~90 mm without irrigation."]
    }
  ],
  "otherCrops": [{ "cropId": "maize", "crop": "Maize", "score": 55, "risk": "high" }],
  "thisWeek": { /* same shape as /api/forecast minus location; null if the forecast service is down */ },
  "meta": { "sources": ["..."], "generatedAt": "2026-09-26T15:00:00Z", "disclaimer": "Advisory estimate…" }
}
```

## `POST /api/recommend`
Body: `{ city, country, irrigation?, limit? (1-20, default 5) }`
Returns: `location, alternatives, soil, climateSummary, recommendations, otherCrops, meta`

## `POST /api/climate`
Body: `{ city, country }`. Returns: `location, alternatives, climate, meta` (the `climate` object shown above).

## `POST /api/forecast`
Body: `{ city, country, crop? (default "maize") }`
```jsonc
{
  "location": { ... }, "crop": { "id": "maize", "name": "Maize" },
  "headline": [   // up to 3 top actions for the week, most severe first
    { "type": "skip_irrigation", "severity": "medium", "title": "Delay irrigation",
      "detail": "Rain expected Thursday (18 mm). Save water and fuel.",
      "why": "18 mm at 80% chance (threshold 5 mm at 60%).", "date": "2026-10-01", "weekday": "Thursday" }
  ],
  "days": [   // 7 items
    { "date": "2026-09-26", "weekday": "Saturday", "tmaxC": 27.3, "tminC": 12.1, "rainMm": 0, "rainChancePct": 16,
      "windKmh": 14, "confidence": "high",    // high | medium | low  -> fade later days
      "actions": [ /* Action[] */ ], "primary": { /* most important Action */ } }
  ],
  "recentRainMm": 1.2,       // rain in the past 3 days
  "smsText": "FarmSmart Maize: Delay irrigation Thu.",   // ≤160 chars
  "meta": { ... }
}
```
`type` values, with suggested icons: `heavy_rain` 🌧 · `frost` ❄ · `heat_stress` 🌡 · `skip_irrigation` ⏸ · `irrigate` 💧 · `disease_risk` 🍄 · `spray_window` 🧪 · `normal` ✅
`severity`: `high` (red) · `medium` (amber) · `low` (green) · `info` (grey)

## `POST /api/grow-plan`
Body: `{ city, country, crop, plantingMonth? (1-12, default = best month), irrigation?, language? ("en" default; see /api/languages) }`
```jsonc
{
  "location": { ... },
  "crop": { "id": "common_bean", "name": "Common bean", "seasonDays": 90 },
  "plantingMonth": 3,
  "suitability": { "score": 79, "risk": "medium", "successYears": 12, "totalYears": 20 },
  "summary": "…",               // 2-3 sentences
  "varietyAdvice": "…",
  "stages": [   // 6 items -> timeline
    { "id": "land_prep", "name": "Land preparation", "startDate": "2027-02-22", "endDate": "2027-03-14",
      "climate": { "rainMm": 31, "tmaxC": 27.6, "heatDays": 0, "waterBalanceMm": -79 },
      "tips": ["…", "…"] }
    // planting, early_growth, critical, maturity, harvest
  ],
  "risks": [{ "title": "…", "mitigation": "…" }],
  "warnings": ["…"],
  "language": "sw",
  "adviceSource": "ai",          // "ai" (OpenAI wrote the tips) or "template" (fallback rules)
  "meta": { ... }
}
```
The dates and climate numbers always come from our analysis. The LLM only writes `summary`, `varietyAdvice`, `tips` and `risks`.

---

## Errors

Every error has the same shape:
```json
{ "error": { "code": "LOCATION_NOT_FOUND", "message": "Could not find \"Xyz\" in Kenya. Try a nearby town or check the spelling." } }
```
| HTTP | code | show the user |
|---|---|---|
| 400 | `INVALID_INPUT` | highlight the fields in `error.details[].field` |
| 404 | `LOCATION_NOT_FOUND` | `error.message` |
| 422 | `UNSUPPORTED_COUNTRY` | `error.message`; `error.details.supportedCountries` lists valid countries |
| 429 | (rate limit) | "Too many requests, wait a moment" |
| 502 | `UPSTREAM_UNAVAILABLE` | "Weather service unavailable, try again" |
| 503 | `RATE_LIMITED` | "Busy, retrying in a minute" (`retryAfterSeconds`) |

`error.message` is always safe to show directly in the UI.
