import app from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { monitoringQueue } from './config/queue.js';
import { redis } from './config/redis.js';

const server = app.listen(env.PORT, () => console.log(`AI Watchman API running at http://localhost:${env.PORT}`));

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), monitoringQueue.close()]);
    await redis.quit().catch(() => {});
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
