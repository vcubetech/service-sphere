// Alert persistence + webhook notification (rules live in alertRules.js).
// The LangGraph agent enriches these candidates with LLM reasoning and RAG citations.
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';

import { evaluateRules, SEV } from './alertRules.js';

export { evaluateRules };

/** Persist alerts, skipping duplicates of an OPEN alert of the same type in the last 30 days. */
export async function saveAlerts(propertyId, detectionId, alerts) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const saved = [];
  for (const a of alerts) {
    const dup = await prisma.alert.findFirst({
      where: { propertyId, type: a.type, status: 'OPEN', createdAt: { gte: since } },
    });
    if (dup) {
      // keep the latest evidence + escalate severity if it got worse
      const severity = SEV.indexOf(a.severity) > SEV.indexOf(dup.severity) ? a.severity : dup.severity;
      saved.push(await prisma.alert.update({
        where: { id: dup.id },
        data: { severity, message: a.message, recommendation: a.recommendation ?? dup.recommendation, citations: a.citations ?? dup.citations, detectionId },
      }));
      continue;
    }
    const row = await prisma.alert.create({
      data: {
        propertyId, detectionId, type: a.type, severity: a.severity, title: a.title, message: a.message,
        recommendation: a.recommendation || null, citations: a.citations || null,
      },
    });
    saved.push(row);
    notify(row).catch((e) => console.warn('[alert webhook]', e.message));
  }
  return saved;
}

async function notify(alert) {
  if (!config.alertWebhookUrl || !['HIGH', 'CRITICAL'].includes(alert.severity)) return;
  await fetch(config.alertWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `🚨 [${alert.severity}] ${alert.title}\n${alert.message}\n➡ ${alert.recommendation || ''}`, alert }),
  });
}

export function listAlerts({ status, severity, propertyId, limit = 100 } = {}) {
  return prisma.alert.findMany({
    where: { ...(status && { status }), ...(severity && { severity }), ...(propertyId && { propertyId }) },
    include: { property: { select: { surveyNumber: true, subDivision: true, village: true, district: true, ownerName: true } } },
    orderBy: [{ createdAt: 'desc' }],
    take: Number(limit),
  });
}

export function updateAlertStatus(id, status) {
  return prisma.alert.update({ where: { id }, data: { status } });
}
