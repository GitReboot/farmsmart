import { cached, HOUR } from '../lib/cache.js';
import { fetchJson } from '../lib/http.js';

// ISRIC SoilGrids v2 (free, no key). It is occasionally slow or down, so callers must accept null.
const SOILGRIDS_URL = 'https://rest.isric.org/soilgrids/v2.0/properties/query';

export interface SoilInfo {
  ph: number | null;
  clayPct: number | null;
  sandPct: number | null;
  organicCarbonGPerKg: number | null;
  texture: string | null;
  depth: '0-30cm';
}

interface SoilGridsResponse {
  properties: {
    layers: {
      name: string;
      unit_measure: { d_factor: number };
      depths: { label: string; values: { mean: number | null } }[];
    }[];
  };
}

function texture(clay: number | null, sand: number | null): string | null {
  if (clay == null || sand == null) return null;
  if (clay >= 40) return 'clay';
  if (sand >= 70) return 'sandy';
  if (clay >= 27) return 'clay loam';
  if (sand >= 50) return 'sandy loam';
  return 'loam';
}

export async function fetchSoil(lat: number, lon: number): Promise<SoilInfo | null> {
  const params = new URLSearchParams({ lon: String(lon), lat: String(lat), value: 'mean' });
  for (const p of ['phh2o', 'clay', 'sand', 'soc']) params.append('property', p);
  for (const d of ['0-5cm', '5-15cm', '15-30cm']) params.append('depth', d);

  try {
    const { soil } = await cached(`soil:${lat},${lon}`, 24 * HOUR, async () => {
      const data = await fetchJson<SoilGridsResponse>(`${SOILGRIDS_URL}?${params}`, 'SoilGrids', 8000);
      const avg = (name: string): number | null => {
        const layer = data.properties.layers.find((l) => l.name === name);
        const vals = layer?.depths.map((d) => d.values.mean).filter((v): v is number => v != null) ?? [];
        if (!layer || !vals.length) return null;
        return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length / layer.unit_measure.d_factor) * 10) / 10;
      };
      const clayPct = avg('clay');
      const sandPct = avg('sand');
      const soil: SoilInfo = {
        ph: avg('phh2o'),
        clayPct,
        sandPct,
        organicCarbonGPerKg: avg('soc'),
        texture: texture(clayPct, sandPct),
        depth: '0-30cm',
      };
      return { soil };
    });
    return soil.ph == null && soil.clayPct == null ? null : soil;
  } catch {
    return null;
  }
}
