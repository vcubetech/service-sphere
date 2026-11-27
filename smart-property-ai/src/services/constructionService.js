// Construction monitoring: progress vs. schedule, permit compliance, stall detection
import { prisma } from '../db/prisma.js';

const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));

/** Planned progress (%) at a date using an S-curve (slow start, fast middle, slow finish). */
export function expectedProgress(project, at = new Date()) {
  const t = (at - project.startDate) / (project.expectedEndDate - project.startDate);
  const u = clamp(t, 0, 1);
  return +(100 * u * u * (3 - 2 * u)).toFixed(1);
}

/** Map progress + change types to a human-readable construction stage. */
export function inferStage(progressPct, byType = {}) {
  if (progressPct >= 98) return 'Completed';
  if (progressPct < 5) return byType.EARTHWORK || byType.VEGETATION_LOSS ? 'Site clearing' : 'Not started';
  if (progressPct < 25) return 'Excavation & foundation';
  if (progressPct < 45) return 'Plinth & ground floor';
  if (progressPct < 80) return 'Superstructure';
  return 'Finishing';
}

/**
 * Record a progress point from a change detection and evaluate the project.
 * Progress = growth of built-up footprint relative to the planned final footprint.
 */
export async function recordProgress(project, detection, stats) {
  const history = await prisma.constructionProgress.findMany({
    where: { projectId: project.id }, orderBy: { recordedAt: 'asc' },
  });
  let baseline = project.baselineBuiltUpPct;
  if (baseline == null) {
    baseline = stats.builtUpBefore;
    await prisma.constructionProject.update({ where: { id: project.id }, data: { baselineBuiltUpPct: baseline } });
  }
  const span = Math.max(1, project.targetBuiltUpPct - baseline);
  const progressPct = +clamp(((stats.builtUpAfter - baseline) / span) * 100).toFixed(1);

  const recordedAt = detection.afterImage?.capturedAt ?? new Date();
  const expectedPct = expectedProgress(project, recordedAt);
  const stage = inferStage(progressPct, stats.byType);

  const point = await prisma.constructionProgress.create({
    data: {
      projectId: project.id, detectionId: detection.id, recordedAt,
      builtUpPct: stats.builtUpAfter, progressPct, expectedPct, stage,
    },
  });
  return evaluate(project, [...history, point]);
}

/** Derive status + issues from the progress history. */
export async function evaluate(project, history) {
  const last = history.at(-1);
  const issues = [];
  if (!last) return { status: project.status, issues, last: null };

  let status = last.progressPct >= 98 ? 'COMPLETED' : last.progressPct > 0 ? 'IN_PROGRESS' : 'PLANNED';

  // stalled: < 2 % progress across the last 60+ days
  const old = [...history].reverse().find((h) => last.recordedAt - h.recordedAt >= 60 * 86_400_000);
  if (old && status !== 'COMPLETED' && last.progressPct - old.progressPct < 2) {
    status = 'STALLED';
    issues.push({ type: 'CONSTRUCTION_STALLED', detail: `Progress moved only ${(last.progressPct - old.progressPct).toFixed(1)}% since ${old.recordedAt.toISOString().slice(0, 10)}.` });
  }
  const gap = last.expectedPct - last.progressPct;
  if (gap > 20 && status !== 'COMPLETED') {
    issues.push({ type: 'CONSTRUCTION_DELAY', detail: `Actual ${last.progressPct}% vs planned ${last.expectedPct}% (behind by ${gap.toFixed(1)} pts).` });
  }
  if (last.builtUpPct > project.permittedBuiltUpPct) {
    issues.push({ type: 'PERMIT_VIOLATION', detail: `Ground coverage ${last.builtUpPct}% exceeds permitted ${project.permittedBuiltUpPct}% (permit ${project.permitNumber || 'n/a'}).` });
  }

  if (status !== project.status) {
    await prisma.constructionProject.update({ where: { id: project.id }, data: { status } });
  }
  return { status, issues, last, history };
}

export function activeProject(propertyId) {
  return prisma.constructionProject.findFirst({
    where: { propertyId, status: { in: ['PLANNED', 'IN_PROGRESS', 'STALLED'] } },
    orderBy: { startDate: 'desc' },
  });
}

export function projectTimeline(projectId) {
  return prisma.constructionProject.findUnique({
    where: { id: projectId },
    include: { progress: { orderBy: { recordedAt: 'asc' } }, property: true },
  });
}
