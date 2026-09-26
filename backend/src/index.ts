import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { HttpError, UpstreamError } from './lib/errors.js';
import { api } from './routes/api.js';

const app = express();
app.set('trust proxy', 1); // behind Render/Railway proxy, so rate limiting sees the real client IP

app.use(helmet());
app.use(cors({ origin: config.allowedOrigins, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '10kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));

// Log method, path, status, and duration only — never query strings or bodies (they contain the farmer's location).
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Date.now() - start}ms`));
  next();
});

app.use('/api', api);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint. See /api/health.' } });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof UpstreamError) {
    console.warn(`[upstream] ${err.message}`);
    if (err.rateLimited) {
      res.set('Retry-After', '60');
      res.status(503).json({ error: { code: 'RATE_LIMITED', message: 'Weather data service is busy. Please try again in about a minute.', retryAfterSeconds: 60 } });
      return;
    }
    res.status(502).json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: `${err.service} is not responding. Please try again in a minute.` } });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
});

app.listen(config.port, () => {
  console.log(`FarmSmart API on http://localhost:${config.port}  (CORS: ${config.allowedOrigins.join(', ')})`);
});
