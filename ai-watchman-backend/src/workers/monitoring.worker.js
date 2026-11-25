import { UnrecoverableError, Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../config/db.js';
import { findSentinelImages } from '../services/gee.js';

const NO_IMAGERY_ALERT = {
  type: 'CUSTOM',
  severity: 'LOW',
  title: 'No satellite imagery found',
  message: 'No Sentinel-2 images matched the selected date range and cloud threshold.',
};

async function processMonitoringJob(queueJob) {
  const { monitoringJobId } = queueJob.data;
  const job = await prisma.monitoringJob.findUnique({
    where: { id: monitoringJobId },
    select: { id: true, propertyId: true, startDate: true, endDate: true, cloudMaxPercent: true, property: { select: { boundary: true } } },
  });
  // Retrying cannot fix a deleted job, so skip BullMQ's retry/backoff cycle.
  if (!job) throw new UnrecoverableError(`Monitoring job ${monitoringJobId} not found`);

  await prisma.monitoringJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date() } });
  try {
    const images = await findSentinelImages({
      geojson: job.property.boundary,
      startDate: job.startDate.toISOString(),
      endDate: job.endDate.toISOString(),
      cloudMaxPercent: job.cloudMaxPercent,
    });
    const result = { imageCount: images.features?.length ?? 0, images };

    const completeJob = prisma.monitoringJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', result, completedAt: new Date() } });
    if (result.imageCount) {
      await completeJob;
    } else {
      await prisma.$transaction([completeJob, prisma.alert.create({ data: { ...NO_IMAGERY_ALERT, propertyId: job.propertyId } })]);
    }
    return result;
  } catch (error) {
    await prisma.monitoringJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorMessage: error.message, completedAt: new Date() } });
    throw error;
  }
}

const worker = new Worker(env.QUEUE_NAME, processMonitoringJob, { connection: redis, concurrency: 3 });
worker.on('completed', (job) => console.log(`Monitoring job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`Monitoring job ${job?.id} failed:`, err.message));
console.log(`AI Watchman worker listening on queue ${env.QUEUE_NAME}`);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
