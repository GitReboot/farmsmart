/**
 * Crop requirements for common Sub-Saharan African crops.
 * Values are approximations drawn from FAO ECOCROP and FAO-56 (crop coefficients);
 * good enough for ranking, not a substitute for local agronomic advice.
 */
export interface Crop {
  id: string;
  name: string;
  seasonDays: number;
  /** Optimal / absolute range of season-average daily mean temperature (°C). */
  tOpt: [number, number];
  tAbs: [number, number];
  /** Optimal rainfall over the whole season (mm) and the absolute minimum. */
  rainOpt: [number, number];
  rainAbsMin: number;
  /** Daily max temperature above which the critical stage is stressed (°C). */
  heatStressC: number;
  frostSensitive: boolean;
  ph: [number, number];
  /** Season-average FAO-56 crop coefficient (ETc = ET0 × Kc). */
  kc: number;
  /** Most weather-sensitive growth stage, as a fraction of the season. */
  critical: { name: string; window: [number, number] };
  droughtTolerance: 'low' | 'medium' | 'high';
}

export const CROPS: Crop[] = [
  { id: 'maize', name: 'Maize', seasonDays: 120, tOpt: [18, 32], tAbs: [10, 40], rainOpt: [500, 800], rainAbsMin: 350, heatStressC: 35, frostSensitive: true, ph: [5.5, 7.5], kc: 0.85, critical: { name: 'tasseling and silking', window: [0.45, 0.65] }, droughtTolerance: 'low' },
  { id: 'sorghum', name: 'Sorghum', seasonDays: 110, tOpt: [22, 35], tAbs: [8, 42], rainOpt: [400, 650], rainAbsMin: 250, heatStressC: 38, frostSensitive: true, ph: [5.5, 8.5], kc: 0.8, critical: { name: 'flowering', window: [0.5, 0.7] }, droughtTolerance: 'high' },
  { id: 'pearl_millet', name: 'Pearl millet', seasonDays: 90, tOpt: [25, 35], tAbs: [12, 44], rainOpt: [300, 500], rainAbsMin: 200, heatStressC: 40, frostSensitive: true, ph: [5.0, 8.0], kc: 0.75, critical: { name: 'flowering', window: [0.45, 0.65] }, droughtTolerance: 'high' },
  { id: 'finger_millet', name: 'Finger millet', seasonDays: 120, tOpt: [18, 28], tAbs: [11, 35], rainOpt: [450, 750], rainAbsMin: 300, heatStressC: 34, frostSensitive: true, ph: [5.0, 7.5], kc: 0.8, critical: { name: 'flowering', window: [0.5, 0.7] }, droughtTolerance: 'medium' },
  { id: 'teff', name: 'Teff', seasonDays: 100, tOpt: [15, 27], tAbs: [8, 32], rainOpt: [300, 550], rainAbsMin: 250, heatStressC: 32, frostSensitive: true, ph: [5.0, 7.5], kc: 0.75, critical: { name: 'flowering', window: [0.5, 0.7] }, droughtTolerance: 'medium' },
  { id: 'rice', name: 'Rice (rain-fed lowland)', seasonDays: 120, tOpt: [22, 32], tAbs: [12, 38], rainOpt: [800, 1200], rainAbsMin: 600, heatStressC: 35, frostSensitive: true, ph: [5.0, 7.0], kc: 1.05, critical: { name: 'flowering', window: [0.5, 0.7] }, droughtTolerance: 'low' },
  { id: 'cassava', name: 'Cassava', seasonDays: 300, tOpt: [22, 32], tAbs: [12, 40], rainOpt: [1000, 1500], rainAbsMin: 600, heatStressC: 40, frostSensitive: true, ph: [4.5, 7.5], kc: 0.75, critical: { name: 'establishment', window: [0.05, 0.3] }, droughtTolerance: 'high' },
  { id: 'sweet_potato', name: 'Sweet potato', seasonDays: 120, tOpt: [20, 30], tAbs: [10, 38], rainOpt: [450, 750], rainAbsMin: 350, heatStressC: 35, frostSensitive: true, ph: [5.0, 7.0], kc: 0.8, critical: { name: 'root formation', window: [0.3, 0.6] }, droughtTolerance: 'medium' },
  { id: 'potato', name: 'Irish potato', seasonDays: 110, tOpt: [14, 22], tAbs: [5, 30], rainOpt: [400, 650], rainAbsMin: 300, heatStressC: 28, frostSensitive: true, ph: [5.0, 6.5], kc: 0.85, critical: { name: 'tuber formation', window: [0.35, 0.65] }, droughtTolerance: 'low' },
  { id: 'common_bean', name: 'Common bean', seasonDays: 90, tOpt: [16, 26], tAbs: [8, 32], rainOpt: [300, 500], rainAbsMin: 250, heatStressC: 30, frostSensitive: true, ph: [5.5, 7.5], kc: 0.8, critical: { name: 'flowering and pod fill', window: [0.4, 0.65] }, droughtTolerance: 'low' },
  { id: 'cowpea', name: 'Cowpea', seasonDays: 90, tOpt: [22, 33], tAbs: [12, 40], rainOpt: [300, 500], rainAbsMin: 200, heatStressC: 36, frostSensitive: true, ph: [5.5, 7.5], kc: 0.75, critical: { name: 'flowering and pod fill', window: [0.4, 0.65] }, droughtTolerance: 'high' },
  { id: 'groundnut', name: 'Groundnut', seasonDays: 120, tOpt: [22, 32], tAbs: [12, 38], rainOpt: [450, 700], rainAbsMin: 300, heatStressC: 35, frostSensitive: true, ph: [5.5, 7.0], kc: 0.8, critical: { name: 'pegging and pod fill', window: [0.3, 0.7] }, droughtTolerance: 'medium' },
  { id: 'soybean', name: 'Soybean', seasonDays: 110, tOpt: [20, 30], tAbs: [10, 38], rainOpt: [450, 700], rainAbsMin: 350, heatStressC: 35, frostSensitive: true, ph: [6.0, 7.5], kc: 0.85, critical: { name: 'flowering and pod fill', window: [0.45, 0.75] }, droughtTolerance: 'medium' },
  { id: 'pigeon_pea', name: 'Pigeon pea', seasonDays: 180, tOpt: [20, 32], tAbs: [10, 40], rainOpt: [600, 1000], rainAbsMin: 400, heatStressC: 38, frostSensitive: true, ph: [5.0, 7.5], kc: 0.75, critical: { name: 'flowering', window: [0.5, 0.7] }, droughtTolerance: 'high' },
  { id: 'sunflower', name: 'Sunflower', seasonDays: 110, tOpt: [18, 30], tAbs: [8, 38], rainOpt: [400, 650], rainAbsMin: 300, heatStressC: 35, frostSensitive: true, ph: [6.0, 7.5], kc: 0.8, critical: { name: 'flowering', window: [0.45, 0.65] }, droughtTolerance: 'medium' },
  { id: 'tomato', name: 'Tomato', seasonDays: 110, tOpt: [18, 28], tAbs: [10, 35], rainOpt: [400, 600], rainAbsMin: 300, heatStressC: 32, frostSensitive: true, ph: [5.5, 7.0], kc: 0.85, critical: { name: 'flowering and fruit set', window: [0.35, 0.7] }, droughtTolerance: 'low' },
];

export const CROP_IDS = CROPS.map((c) => c.id) as [string, ...string[]];
export const cropById = (id: string) => CROPS.find((c) => c.id === id);
