// Nightly autonomous monitoring: re-scan every property that has a new image since its last scan
import cron from 'node-cron';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { scanProperty } from '../agents/monitoringGraph.js';

export async function scanAllPending() {
  const props = await prisma.property.findMany({
    select: {
      id: true, surveyNumber: true,
      images: { orderBy: { capturedAt: 'desc' }, take: 1, select: { id: true } },
      detections: { orderBy: { createdAt: 'desc' }, take: 1, select: { afterImageId: true } },
      _count: { select: { images: true } },
    },
  });
  const pending = props.filter((p) => p._count.images >= 2 && p.images[0]?.id !== p.detections[0]?.afterImageId);
  console.log(`[monitor] ${pending.length} properties with new imagery`);
  for (const p of pending) {
    try {
      const r = await scanProperty(p.id, { trigger: 'SCHEDULED' });
      console.log(`[monitor] Sy.No ${p.surveyNumber}: risk=${r.overallRisk} alerts=${r.alerts.length}`);
    } catch (e) {
      console.error(`[monitor] ${p.surveyNumber} failed:`, e.message);
    }
  }
  return pending.length;
}

export function startScheduler() {
  if (!config.monitorCron) return;
  if (!cron.validate(config.monitorCron)) return console.warn('[monitor] invalid MONITOR_CRON, scheduler disabled');
  cron.schedule(config.monitorCron, () => scanAllPending().catch((e) => console.error('[monitor]', e)));
  console.log(`   Monitor schedule: ${config.monitorCron}`);
}
