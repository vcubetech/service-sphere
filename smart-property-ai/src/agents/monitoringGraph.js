/**
 * Property Monitoring Agent — LangGraph StateGraph
 *
 *   START
 *     │
 *  [detect_changes] ──(no image pair / error)──────────────┐
 *     │                                                    │
 *  [check_construction]                                    │
 *     │                                                    │
 *  [apply_rules] ──(nothing to report)──────────────────┐  │
 *     │                                                 │  │
 *  [retrieve_regulations]   (RAG over pgvector)         │  │
 *     │                                                 │  │
 *  [ai_assessment]          (LLM, structured output)    │  │
 *     │                                                 │  │
 *  [persist_alerts]                                     │  │
 *     │                                                 ▼  ▼
 *  [finish]  ── writes AgentRun audit log ──> END
 *
 * Deterministic rules decide *whether* something is wrong (auditable);
 * the LLM explains *why it matters*, grounds it in retrieved regulations,
 * calibrates severity and recommends the next action.
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { runDetection } from '../services/detectionService.js';
import { activeProject, recordProgress } from '../services/constructionService.js';
import { evaluateRules, saveAlerts } from '../services/alertService.js';
import { similaritySearch } from '../rag/vectorStore.js';
import { getChatModel } from '../ai/llm.js';

const last = () => Annotation({ reducer: (_, b) => b, default: () => null });

const State = Annotation.Root({
  propertyId: last(),
  trigger: last(),
  beforeImageId: last(),
  afterImageId: last(),
  property: last(),
  detection: last(),
  stats: last(),
  regions: last(),
  encroachment: last(),
  project: last(),
  construction: last(),
  candidates: last(),
  context: last(),
  assessment: last(),
  alerts: last(),
  error: last(),
  startedAt: last(),
  steps: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

const step = (node, info) => ({ steps: [{ node, at: new Date().toISOString(), ...info }] });

// ---------------------------------------------------------------- nodes

async function detectChangesNode(s) {
  try {
    const r = await runDetection(s.propertyId, { beforeImageId: s.beforeImageId, afterImageId: s.afterImageId });
    return {
      property: r.property,
      detection: { ...r.detection, afterImage: r.images.after, beforeImage: r.images.before },
      stats: r.stats,
      regions: r.regions,
      encroachment: r.encroachment,
      ...step('detect_changes', { changedPercent: r.stats.changedPercent, regions: r.regions.length }),
    };
  } catch (e) {
    return { error: e.message, ...step('detect_changes', { error: e.message }) };
  }
}

async function checkConstructionNode(s) {
  const project = await activeProject(s.propertyId);
  if (!project) return { project: null, ...step('check_construction', { project: null }) };
  const construction = await recordProgress(project, s.detection, s.stats);
  return {
    project,
    construction: { status: construction.status, issues: construction.issues, last: construction.last },
    ...step('check_construction', { status: construction.status, progress: construction.last?.progressPct }),
  };
}

async function applyRulesNode(s) {
  const candidates = evaluateRules({
    property: s.property, stats: s.stats, regions: s.regions,
    encroachment: s.encroachment, project: s.project, construction: s.construction,
  });
  return { candidates, ...step('apply_rules', { candidates: candidates.map((c) => `${c.type}:${c.severity}`) }) };
}

const QUERY_BY_TYPE = {
  UNAUTHORIZED_CONSTRUCTION: 'building permit required before construction, penalty for unauthorised construction, notice and demolition procedure',
  ENCROACHMENT: 'encroachment on neighbouring survey number or government land, boundary dispute, re-survey and eviction procedure',
  PERMIT_VIOLATION: 'maximum ground coverage FAR setback violation of sanctioned plan, regularisation and penalty',
  LAND_USE_VIOLATION: 'construction on agricultural land, conversion of land use, non-agricultural permission',
  CONSTRUCTION_DELAY: 'construction completion period, permit validity, extension of building licence',
  CONSTRUCTION_STALLED: 'abandoned or stalled construction, permit lapse, site safety',
  DEMOLITION_DETECTED: 'demolition permission, heritage structure, debris disposal',
  VEGETATION_LOSS: 'tree felling permission, compensatory plantation, green cover requirement',
};

async function retrieveRegulationsNode(s) {
  const seen = new Map();
  const loc = `${s.property.state} ${s.property.district} ${s.property.landUse}`;
  for (const type of new Set(s.candidates.map((c) => c.type))) {
    const hits = await similaritySearch(`${QUERY_BY_TYPE[type] || type} ${loc}`, { k: 4 });
    for (const h of hits) if (!seen.has(h.id) || seen.get(h.id).score < h.score) seen.set(h.id, { ...h, forType: type });
  }
  const context = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  return { context, ...step('retrieve_regulations', { chunks: context.length }) };
}

const AlertTypes = z.enum(['UNAUTHORIZED_CONSTRUCTION', 'ENCROACHMENT', 'PERMIT_VIOLATION', 'CONSTRUCTION_DELAY',
  'CONSTRUCTION_STALLED', 'DEMOLITION_DETECTED', 'VEGETATION_LOSS', 'LAND_USE_VIOLATION', 'GENERAL']);

const AssessmentSchema = z.object({
  overallRisk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  summary: z.string().describe('2-4 sentence plain-language summary for a property officer'),
  alerts: z.array(z.object({
    type: AlertTypes,
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    title: z.string(),
    message: z.string().describe('What was detected, with numbers, and why it matters'),
    recommendation: z.string().describe('Concrete next action for the officer / owner'),
    citationIds: z.array(z.string()).describe('ids of regulation chunks that support this alert'),
  })),
});

const SYSTEM = `You are a land-records & building-compliance analyst for a municipal / revenue authority.
You receive facts from satellite change detection, PostGIS boundary checks, construction monitoring,
rule-engine candidate alerts and retrieved regulation excerpts.
Rules:
- Only raise alerts supported by the facts. Keep every candidate alert unless the facts clearly contradict it;
  you may change its severity by at most ONE level and must say why in the message.
- You may add at most one GENERAL alert for a material risk the rules missed.
- Ground recommendations in the regulation excerpts and cite them by id. Never invent section numbers.
- Satellite analysis is probabilistic: recommend field verification before punitive action.
- Be concise, factual, and specific (survey number, areas in m², percentages, dates).`;

async function aiAssessmentNode(s) {
  const llm = getChatModel();
  const facts = {
    property: s.property && { ...s.property, boundary: undefined },
    period: { from: s.detection.beforeImage?.capturedAt, to: s.detection.afterImage?.capturedAt },
    stats: s.stats,
    regions: s.regions.map(({ geometry, ...r }) => r).slice(0, 15),
    encroachment: (s.encroachment || []).map(({ geometry, ...e }) => e),
    construction: s.project && { permit: s.project.permitNumber, permittedBuiltUpPct: s.project.permittedBuiltUpPct, ...s.construction },
    candidateAlerts: s.candidates.map(({ evidence, ...c }) => c),
  };

  if (!llm) {
    // offline fallback: template recommendations + top-scoring citations
    const alerts = s.candidates.map((c) => ({
      ...c,
      recommendation: FALLBACK_ACTION[c.type] || 'Schedule a field inspection to verify.',
      citations: (s.context || []).filter((x) => x.forType === c.type).slice(0, 2).map(cite),
    }));
    const overallRisk = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].find((r) => alerts.some((a) => a.severity === r)) || 'LOW';
    return { assessment: { overallRisk, summary: s.detection.summary, mode: 'rules-only' }, alerts, ...step('ai_assessment', { mode: 'rules-only' }) };
  }

  const ctx = (s.context || []).map((c) => `[${c.id}] (${c.source} — ${c.title})\n${c.content}`).join('\n\n---\n\n');
  const res = await llm.withStructuredOutput(AssessmentSchema, { name: 'property_assessment' }).invoke([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `FACTS:\n${JSON.stringify(facts, null, 2)}\n\nREGULATION EXCERPTS:\n${ctx || '(none found)'}` },
  ]);

  const byId = new Map((s.context || []).map((c) => [c.id, c]));
  const alerts = res.alerts.map((a) => ({
    ...a,
    citations: a.citationIds.map((id) => byId.get(id)).filter(Boolean).map(cite),
  }));
  return {
    assessment: { overallRisk: res.overallRisk, summary: res.summary, mode: 'llm' },
    alerts,
    ...step('ai_assessment', { mode: 'llm', overallRisk: res.overallRisk, alerts: alerts.length }),
  };
}

const cite = (c) => ({ id: c.id, source: c.source, title: c.title, excerpt: c.content.slice(0, 280), score: c.score });

const FALLBACK_ACTION = {
  UNAUTHORIZED_CONSTRUCTION: 'Verify on site; if no sanctioned plan exists, issue a stop-work notice and call for documents within the statutory period.',
  ENCROACHMENT: 'Order a joint boundary re-survey with the affected owners / revenue surveyor before any further construction.',
  PERMIT_VIOLATION: 'Compare the structure with the sanctioned plan; issue a deviation notice and assess regularisation eligibility.',
  LAND_USE_VIOLATION: 'Check for a land-use conversion (NA) order; if absent, refer to the revenue authority.',
  CONSTRUCTION_DELAY: 'Contact the permit holder for a revised schedule and check permit validity.',
  CONSTRUCTION_STALLED: 'Inspect the site for safety hazards and check whether the building permit is about to lapse.',
  DEMOLITION_DETECTED: 'Confirm that demolition permission was granted and debris was disposed of lawfully.',
  VEGETATION_LOSS: 'Check tree-felling permission and require compensatory plantation where applicable.',
};

async function persistAlertsNode(s) {
  const saved = await saveAlerts(s.propertyId, s.detection.id, s.alerts || []);
  return { alerts: saved, ...step('persist_alerts', { saved: saved.length }) };
}

async function finishNode(s) {
  const output = {
    error: s.error,
    detectionId: s.detection?.id,
    summary: s.assessment?.summary ?? s.detection?.summary ?? s.error,
    overallRisk: s.assessment?.overallRisk ?? (s.error ? null : 'LOW'),
    mode: s.assessment?.mode,
    stats: s.stats,
    construction: s.construction && { status: s.construction.status, progress: s.construction.last?.progressPct, expected: s.construction.last?.expectedPct, stage: s.construction.last?.stage },
    alerts: (s.alerts || []).map((a) => ({ id: a.id, type: a.type, severity: a.severity, title: a.title })),
  };
  const finalSteps = [...s.steps, { node: 'finish', at: new Date().toISOString() }];
  await prisma.agentRun.create({
    data: {
      propertyId: s.propertyId, trigger: s.trigger || 'SCAN',
      input: { beforeImageId: s.beforeImageId, afterImageId: s.afterImageId },
      output, steps: finalSteps, durationMs: Date.now() - s.startedAt,
    },
  });
  return step('finish', {});
}

// ---------------------------------------------------------------- graph

export const monitoringGraph = new StateGraph(State)
  .addNode('detect_changes', detectChangesNode)
  .addNode('check_construction', checkConstructionNode)
  .addNode('apply_rules', applyRulesNode)
  .addNode('retrieve_regulations', retrieveRegulationsNode)
  .addNode('ai_assessment', aiAssessmentNode)
  .addNode('persist_alerts', persistAlertsNode)
  .addNode('finish', finishNode)
  .addEdge(START, 'detect_changes')
  .addConditionalEdges('detect_changes', (s) => (s.error ? 'finish' : 'check_construction'))
  .addEdge('check_construction', 'apply_rules')
  .addConditionalEdges('apply_rules', (s) => (s.candidates.length ? 'retrieve_regulations' : 'finish'))
  .addEdge('retrieve_regulations', 'ai_assessment')
  .addEdge('ai_assessment', 'persist_alerts')
  .addEdge('persist_alerts', 'finish')
  .addEdge('finish', END)
  .compile();

/** Run a full AI scan of one property. */
export async function scanProperty(propertyId, { beforeImageId, afterImageId, trigger = 'SCAN' } = {}) {
  const final = await monitoringGraph.invoke({ propertyId, beforeImageId, afterImageId, trigger, startedAt: Date.now() });
  return {
    propertyId,
    error: final.error,
    overallRisk: final.assessment?.overallRisk ?? null,
    summary: final.assessment?.summary ?? final.detection?.summary ?? final.error,
    mode: final.assessment?.mode ?? null,
    detection: final.detection && { id: final.detection.id, overlay: `/api/detections/${final.detection.id}/overlay`, ...final.stats },
    regions: (final.regions || []).map(({ geometry, ...r }) => r),
    encroachment: final.encroachment,
    construction: final.construction,
    alerts: final.alerts || [],
    steps: final.steps,
  };
}
