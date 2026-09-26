import { UpstreamError } from './errors.js';

export async function fetchJson<T>(url: string, service: string, timeoutMs = 15000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'FarmSmart/0.1 (hackathon project)' },
    });
  } catch {
    throw new UpstreamError(service, `${service} is unreachable or timed out`);
  }
  if (res.status === 429) {
    throw new UpstreamError(service, `${service} rate limit reached`, true);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new UpstreamError(service, `${service} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}
