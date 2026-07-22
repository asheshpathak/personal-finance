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
};
