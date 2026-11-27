/**
 * Conversational Property Assistant — LangGraph ReAct agent with tools + RAG.
 * Example questions:
 *   "Show open critical alerts in Bengaluru Urban"
 *   "What changed on survey number 123/4 in Yelahanka?"
 *   "Is 62% ground coverage allowed for a residential plot? cite the rule"
 *   "Run a fresh scan for survey 123/4 and tell me if there is encroachment"
 */
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { getChatModel } from '../ai/llm.js';
import { findBySurveyNumber, findByPoint, findNeighbours } from '../services/geoService.js';
import { listAlerts } from '../services/alertService.js';
import { similaritySearch } from '../rag/vectorStore.js';
import { scanProperty } from './monitoringGraph.js';

const json = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 2).slice(0, 6000);

const tools = [
  tool(async (a) => json(await findBySurveyNumber(a)), {
    name: 'lookup_survey_number',
    description: 'Find a land parcel by survey number (optionally sub-division, village, district). Returns owner, land use, area, boundary.',
    schema: z.object({
      surveyNumber: z.string(), subDivision: z.string().optional(),
      village: z.string().optional(), district: z.string().optional(),
    }),
  }),
  tool(async ({ lon, lat }) => json(await findByPoint(lon, lat)), {
    name: 'parcel_at_location',
    description: 'Find which survey parcel contains a GPS coordinate.',
    schema: z.object({ lon: z.number(), lat: z.number() }),
  }),
  tool(async ({ propertyId }) => json(await findNeighbours(propertyId)), {
    name: 'neighbouring_parcels',
    description: 'List parcels adjacent to a property (for boundary / encroachment questions).',
    schema: z.object({ propertyId: z.string() }),
  }),
  tool(async (a) => json((await listAlerts({ ...a, limit: a.limit ?? 20 })).map(({ citations, ...x }) => x)), {
    name: 'get_alerts',
    description: 'List alerts. Filter by propertyId, status (OPEN, ACKNOWLEDGED, RESOLVED, DISMISSED) and severity (LOW..CRITICAL).',
    schema: z.object({
      propertyId: z.string().optional(),
      status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      limit: z.number().optional(),
    }),
  }),
  tool(async ({ propertyId }) => json(await prisma.changeDetection.findMany({
    where: { propertyId }, orderBy: { createdAt: 'desc' }, take: 5,
    select: { id: true, createdAt: true, summary: true, changedPercent: true, builtUpBefore: true, builtUpAfter: true,
      regions: { select: { type: true, areaSqm: true, confidence: true, insideBoundary: true } } },
  })), {
    name: 'change_history',
    description: 'Recent satellite change-detection results for a property.',
    schema: z.object({ propertyId: z.string() }),
  }),
  tool(async ({ propertyId }) => json(await prisma.constructionProject.findMany({
    where: { propertyId }, include: { progress: { orderBy: { recordedAt: 'asc' } } },
  })), {
    name: 'construction_status',
    description: 'Construction projects, permits and progress timeline for a property.',
    schema: z.object({ propertyId: z.string() }),
  }),
  tool(async ({ query }) => json((await similaritySearch(query, { k: 5 })).map((c) => ({ id: c.id, source: c.source, title: c.title, content: c.content, score: c.score }))), {
    name: 'search_regulations',
    description: 'Semantic search over building bye-laws, zoning rules and land-record procedures (RAG). Use for any rule/legal question and cite the source.',
    schema: z.object({ query: z.string() }),
  }),
  tool(async ({ propertyId }) => json(await scanProperty(propertyId, { trigger: 'CHAT' })), {
    name: 'run_property_scan',
    description: 'Run a fresh satellite change-detection + AI compliance scan on a property (compares the two latest images, creates alerts).',
    schema: z.object({ propertyId: z.string() }),
  }),
];

const SYSTEM = `You are the AI assistant of a Smart Property Management system used by revenue / municipal officers.
Use the tools to answer with real data — never guess survey numbers, owners, areas or alerts.
For rules and procedures, call search_regulations and cite the source name.
Resolve a survey number to a propertyId with lookup_survey_number before calling property-specific tools.
Answer concisely with numbers, dates and survey numbers. Remind users that satellite findings need field verification before enforcement.`;

let agent;
export async function askAssistant(question, { propertyId, history = [] } = {}) {
  const llm = getChatModel(0);
  if (!llm) {
    const e = new Error('Chat assistant needs an LLM: set OPENAI_API_KEY (or an OpenAI-compatible OPENAI_BASE_URL).');
    e.status = 503;
    throw e;
  }
  agent ??= createReactAgent({ llm, tools });
  const messages = [
    new SystemMessage(SYSTEM + (propertyId ? `\nThe user is currently viewing propertyId=${propertyId}.` : '')),
    ...history.map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))),
    new HumanMessage(question),
  ];
  const res = await agent.invoke({ messages }, { recursionLimit: 12 });
  const toolCalls = res.messages.filter((m) => m.tool_calls?.length).flatMap((m) => m.tool_calls.map((t) => ({ tool: t.name, args: t.args })));
  return { answer: res.messages.at(-1).content, toolCalls };
}
