import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // Comma-separated list of frontend origins allowed to call the API.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  historyYears: Number(process.env.HISTORY_YEARS ?? 20),
};
