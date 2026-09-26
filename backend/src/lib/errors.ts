export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** A third-party data source (Open-Meteo, SoilGrids, OpenAI) failed or timed out. */
export class UpstreamError extends Error {
  constructor(
    public service: string,
    message: string,
    public rateLimited = false,
  ) {
    super(message);
  }
}
