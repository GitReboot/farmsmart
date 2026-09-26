export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export function weightedMean(xs: number[], ws: number[]): number {
  const wsum = sum(ws);
  return wsum ? xs.reduce((acc, x, i) => acc + x * ws[i], 0) / wsum : 0;
}

/** Linear-interpolated percentile, p in [0, 100]. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/** Ordinary least-squares slope of y against x. */
export function slope(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den ? num / den : 0;
}

export function stdev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** 0 outside [a, d], 1 inside [b, c], linear ramps in between. */
export function trapezoid(x: number, a: number, b: number, c: number, d: number): number {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  return x < b ? (x - a) / (b - a) : (d - x) / (d - c);
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round = (x: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};
