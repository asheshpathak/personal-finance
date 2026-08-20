import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Reads a required secret. In production a missing value is fatal — falling back
 * to a well-known default would let anyone forge a valid session token.
 * In development we allow a default so the app runs with no .env file.
 */
function requiredInProduction(name: string, devFallback: string): string {
  const value = process.env[name];

  if (value) return value;

  if (isProduction) {
    throw new Error(
      `${name} is not set. Refusing to start in production with an insecure default. ` +
        `Set ${name} in your Railway service variables.`
    );
  }

  console.warn(`[config] ${name} not set — using insecure development default.`);
  return devFallback;
}

export const config = {
  isProduction,

  port: Number(process.env.PORT) || 5001,

  mongoUri: requiredInProduction('MONGODB_URI', 'mongodb://localhost:27017/expense-app'),

  jwtSecret: requiredInProduction('JWT_SECRET', 'dev-only-insecure-secret'),

  /**
   * Comma-separated list of allowed browser origins, e.g.
   * "https://your-app.vercel.app,https://www.yourdomain.com".
   * Empty in development means "reflect any origin" so localhost ports just work.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),

  // ── Claude / Anthropic ────────────────────────────────────────────────────
  /**
   * Server-side key for the Claude API. Optional: without it every AI route
   * answers 503 with a clear message and the client hides the AI surfaces
   * entirely, so the rest of the app is unaffected.
   *
   * Never exposed to the browser — the frontend only ever talks to this server.
   */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',

  /**
   * Model used for every AI feature.
   *
   * Sonnet 5 rather than Opus 5: it is roughly 2.5x cheaper per token in both
   * directions and, more to the point for this app, it thinks less on its way
   * to an answer. Nothing here is a hard reasoning problem — reading a line of
   * text into an expense, ranking a handful of findings, looking up a total —
   * so the extra deliberation was being paid for and not used.
   *
   * **Do not drop to Haiku 4.5 without reading this.** Its minimum cacheable
   * prefix is 4,096 tokens against Sonnet's 1,024, and a smaller financial
   * context would fall under that floor and silently never cache — no error,
   * `cache_creation_input_tokens` simply stays 0 and every request pays full
   * price for the whole prefix. The cheaper model would cost more.
   */
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',

  /**
   * Per-account ceiling on AI calls per rolling hour. This is a personal app,
   * so the limit exists to bound the bill if a client loops, not to ration.
   */
  aiRequestsPerHour: Number(process.env.AI_REQUESTS_PER_HOUR) || 60,
};
