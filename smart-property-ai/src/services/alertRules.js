// Pure, deterministic alert rules (no I/O) — unit-tested in tests/alertRules.test.js
export const SEV = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const bump = (s, n = 1) => SEV[Math.min(3, SEV.indexOf(s) + n)];

/**
 * Pure function: derive candidate alerts from detection facts.
 * @param {object} f { property, stats, regions, encroachment, project, construction }
 */
export function evaluateRules(f) {
  const { property, stats, regions = [], encroachment = [], project, construction } = f;
  const out = [];
  const add = (type, severity, title, message, evidence = {}) => out.push({ type, severity, title, message, evidence });

  // 1. new construction without an active permit
  const newBuild = regions.filter((r) => r.type === 'NEW_CONSTRUCTION' && r.insideBoundary && r.confidence >= 0.5);
  const newArea = newBuild.reduce((a, r) => a + r.areaSqm, 0);
  if (newArea >= 20 && !project) {
    add('UNAUTHORIZED_CONSTRUCTION', newArea > 200 ? 'CRITICAL' : 'HIGH',
      `Unpermitted construction on Survey No. ${sn(property)}`,
      `${newArea.toFixed(0)} m² of new built-up area detected and no active building permit is on record.`,
      { newAreaSqm: newArea, regions: newBuild.length });
  }

  // 2. encroachment: change spilling outside the parcel / onto neighbours
  for (const e of encroachment) {
    const outside = Number(e.outsideSqm) || 0;
    const neighbours = e.overlapsParcels || [];
    if (['NEW_CONSTRUCTION', 'EARTHWORK', 'UNKNOWN'].includes(e.type) && outside >= 5) {
      const who = neighbours.length
        ? ` onto ${neighbours.map((n) => `Sy. No. ${n.surveyNumber}${n.subDivision ? '/' + n.subDivision : ''} (${n.overlapSqm} m²)`).join(', ')}`
        : ' beyond the recorded boundary (public / unsurveyed land)';
      add('ENCROACHMENT', outside > 50 || neighbours.length ? 'CRITICAL' : 'HIGH',
        `Possible encroachment from Survey No. ${sn(property)}`,
        `A ${e.type.replace(/_/g, ' ').toLowerCase()} region extends ${outside.toFixed(1)} m²${who}.`,
        { regionId: e.regionId, outsideSqm: outside, neighbours });
    }
  }
  // fallback when PostGIS report is unavailable (no boundary geometry stored)
  if (!encroachment.length && regions.some((r) => r.crossesBoundary && r.type !== 'VEGETATION_GAIN')) {
    add('ENCROACHMENT', 'HIGH', `Change crosses boundary of Survey No. ${sn(property)}`,
      'A detected change region straddles the recorded parcel boundary.', {});
  }

  // 3. construction-project issues (permit coverage, delay, stall)
  for (const i of construction?.issues || []) {
    const sev = i.type === 'PERMIT_VIOLATION' ? 'HIGH' : i.type === 'CONSTRUCTION_STALLED' ? 'MEDIUM' : 'LOW';
    add(i.type, sev, `${i.type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} — Survey No. ${sn(property)}`, i.detail, {});
  }

  // 4. land-use conflict
  if (property.landUse === 'AGRICULTURAL' && newArea >= 50) {
    add('LAND_USE_VIOLATION', 'MEDIUM', `Construction on agricultural land — Survey No. ${sn(property)}`,
      `${newArea.toFixed(0)} m² built on land classified as AGRICULTURAL; conversion (NA) order should be verified.`, {});
  }

  // 5. demolition
  const demo = regions.filter((r) => r.type === 'DEMOLITION' && r.insideBoundary).reduce((a, r) => a + r.areaSqm, 0);
  if (demo >= 20) {
    add('DEMOLITION_DETECTED', property.landUse === 'GOVERNMENT' ? 'HIGH' : 'MEDIUM',
      `Structure removed on Survey No. ${sn(property)}`, `${demo.toFixed(0)} m² of previously built-up area is no longer present.`, {});
  }

  // 6. vegetation loss
  const vegDrop = (stats?.vegetationBefore ?? 0) - (stats?.vegetationAfter ?? 0);
  if (vegDrop >= 20) {
    add('VEGETATION_LOSS', vegDrop >= 50 ? 'MEDIUM' : 'LOW', `Significant tree / green cover loss — Survey No. ${sn(property)}`,
      `Vegetation cover fell from ${stats.vegetationBefore}% to ${stats.vegetationAfter}% of the parcel.`, { vegDrop });
  }

  // government land: everything is more serious
  if (property.landUse === 'GOVERNMENT') out.forEach((a) => { a.severity = bump(a.severity); });
  return out;
}

export const sn = (p) => `${p.surveyNumber}${p.subDivision ? '/' + p.subDivision : ''}`;

