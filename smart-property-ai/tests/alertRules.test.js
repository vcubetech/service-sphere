import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules } from '../src/services/alertRules.js';
import { chunkText } from '../src/rag/chunker.js';

const property = { surveyNumber: '123', subDivision: '4', landUse: 'RESIDENTIAL' };
const stats = { vegetationBefore: 80, vegetationAfter: 75, builtUpBefore: 0, builtUpAfter: 30 };
const build = { type: 'NEW_CONSTRUCTION', insideBoundary: true, confidence: 0.8, areaSqm: 250 };

test('unpermitted construction > 200 m² is CRITICAL', () => {
  const a = evaluateRules({ property, stats, regions: [build], project: null });
  assert.equal(a[0].type, 'UNAUTHORIZED_CONSTRUCTION');
  assert.equal(a[0].severity, 'CRITICAL');
});

test('no unauthorised alert when an active permit exists', () => {
  const a = evaluateRules({ property, stats, regions: [build], project: { id: 'p1' }, construction: { issues: [] } });
  assert.ok(!a.some((x) => x.type === 'UNAUTHORIZED_CONSTRUCTION'));
});

test('encroachment onto neighbour parcel is CRITICAL and names the survey number', () => {
  const a = evaluateRules({
    property, stats, regions: [build], project: { id: 'p1' },
    encroachment: [{ regionId: 'r1', type: 'NEW_CONSTRUCTION', outsideSqm: 12, overlapsParcels: [{ surveyNumber: '123', subDivision: '5', overlapSqm: 12 }] }],
  });
  const e = a.find((x) => x.type === 'ENCROACHMENT');
  assert.equal(e.severity, 'CRITICAL');
  assert.match(e.message, /123\/5/);
});

test('agricultural land + construction -> land-use violation; vegetation loss', () => {
  const a = evaluateRules({ property: { ...property, landUse: 'AGRICULTURAL' }, stats: { ...stats, vegetationAfter: 20 }, regions: [build] });
  assert.ok(a.some((x) => x.type === 'LAND_USE_VIOLATION'));
  assert.ok(a.some((x) => x.type === 'VEGETATION_LOSS' && x.severity === 'MEDIUM'));
});

test('government land escalates severity', () => {
  const a = evaluateRules({ property: { ...property, landUse: 'GOVERNMENT' }, stats, regions: [{ ...build, areaSqm: 50 }] });
  assert.equal(a.find((x) => x.type === 'UNAUTHORIZED_CONSTRUCTION').severity, 'CRITICAL');
});

test('construction issues become alerts', () => {
  const a = evaluateRules({ property, stats, regions: [], project: { id: 'p' }, construction: { issues: [{ type: 'PERMIT_VIOLATION', detail: 'x' }] } });
  assert.equal(a[0].type, 'PERMIT_VIOLATION');
  assert.equal(a[0].severity, 'HIGH');
});

test('chunker splits by heading', () => {
  const c = chunkText('# A\n\npara one\n\n## B\n\npara two');
  assert.equal(c.length, 2);
  assert.equal(c[1].heading, 'B');
});
