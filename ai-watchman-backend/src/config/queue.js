import { Queue } from 'bullmq';
import { redis } from './redis.js';
import { env } from './env.js';
export const monitoringQueue = new Queue(env.QUEUE_NAME, { connection: redis, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 200, removeOnFail: 500 } });
