import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration, validated once at startup so a missing or
 * malformed variable fails fast instead of on the first request that needs it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('1d'),
  /** Comma-separated list of allowed origins; unset allows any origin. */
  CORS_ORIGIN: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value.split(',').map((origin) => origin.trim()).filter(Boolean)
        : '*',
    ),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${problems}`);
}

export const env = parsed.data;
export const isDevelopment = env.NODE_ENV === 'development';
