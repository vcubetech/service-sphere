import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(24),
  JWT_EXPIRES_IN: z.string().default('1d'),
  CORS_ORIGIN: z.string().default('*'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_NAME: z.string().default('watchman-monitoring'),
  GEE_PROJECT_ID: z.string().optional(),
  GEE_SERVICE_ACCOUNT: z.string().optional(),
  GEE_PRIVATE_KEY: z.string().optional(),
  SENTINEL_COLLECTION: z.string().default('COPERNICUS/S2_SR_HARMONIZED')
});
export const env = schema.parse(process.env);
