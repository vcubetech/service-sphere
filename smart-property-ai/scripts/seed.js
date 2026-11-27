// Seeds demo parcels (survey numbers), satellite images, a construction permit,
// then runs the AI monitoring agent twice (Jan->Jun, Jun->Nov) so the dashboard has data.
//   node scripts/seed.js            # seed + scans
//   node scripts/seed.js --no-scan  # seed only
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../src/db/prisma.js';
import { setBoundary } from '../src/services/geoService.js';
import { registerImage } from '../src/services/imageService.js';
import { scanProperty } from '../src/agents/monitoringGraph.js';
import { pixelToLonLat } from '../src/utils/geo.js';
import { DEMO_EXTENT, DEMO_SIZE, DEMO_PARCEL_PX, generateDemoImages } from './generate-demo-images.js';

const grid = { ...DEMO_EXTENT, width: DEMO_SIZE, height: DEMO_SIZE };
const poly = (pts) => ({ type: 'Polygon', coordinates: [[...pts, pts[0]].map(([x, y]) => pixelToLonLat(x, y, grid))] });

const PARCELS = [
  { surveyNumber: '123', subDivision: '4', ownerName: 'Ramesh Kumar', landUse: 'RESIDENTIAL', px: DEMO_PARCEL_PX },
  { surveyNumber: '123', subDivision: '5', ownerName: 'Lakshmi Devi', landUse: 'RESIDENTIAL', px: [[370, 140], [500, 140], [500, 360], [370, 360]] },
  { surveyNumber: '124', subDivision: '1', ownerName: 'Suresh Gowda', landUse: 'AGRICULTURAL', px: [[20, 140], [150, 140], [150, 400], [20, 400]] },
  { surveyNumber: '125', subDivision: null, ownerName: 'Government of Karnataka (Gomala)', landUse: 'GOVERNMENT', px: [[150, 360], [500, 360], [500, 425], [150, 425]] },
];

async function main() {
  if (!fs.existsSync('data/demo/scene_2026-11-20.png')) await generateDemoImages();

  console.log('… clearing demo data');
  await prisma.agentRun.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.constructionProgress.deleteMany();
  await prisma.changeRegion.deleteMany();
  await prisma.changeDetection.deleteMany();
  await prisma.constructionProject.deleteMany();
  await prisma.satelliteImage.deleteMany();
  await prisma.property.deleteMany();

  const created = {};
  for (const p of PARCELS) {
    const row = await prisma.property.create({
      data: {
        surveyNumber: p.surveyNumber, subDivision: p.subDivision, ownerName: p.ownerName, landUse: p.landUse,
        village: 'Yelahanka', taluk: 'Yelahanka', district: 'Bengaluru Urban', state: 'Karnataka',
      },
    });
    await setBoundary(row.id, poly(p.px));
    created[`${p.surveyNumber}/${p.subDivision ?? ''}`] = row;
    console.log(`✔ parcel Sy.No ${p.surveyNumber}${p.subDivision ? '/' + p.subDivision : ''} (${p.landUse})`);
  }

  const plot = created['123/4'];
  const images = [];
  for (const [file, date, cloud] of [
    ['scene_2026-01-15.png', '2026-01-15', 4],
    ['scene_2026-06-10.png', '2026-06-10', 12],
    ['scene_2026-11-20.png', '2026-11-20', 2],
  ]) {
    images.push(await registerImage(plot.id, {
      filePath: path.resolve('data/demo', file), capturedAt: date, source: 'SENTINEL-2 (demo)',
      ...DEMO_EXTENT, resolutionM: 0.3, cloudCover: cloud,
    }));
    console.log(`✔ image ${date}`);
  }

  await prisma.constructionProject.create({
    data: {
      propertyId: plot.id, permitNumber: 'BBMP/LP/2026/0412', description: 'G+2 residential building',
      permittedBuiltUpPct: 30, permittedFloors: 3, targetBuiltUpPct: 28,
      startDate: new Date('2026-02-01'), expectedEndDate: new Date('2027-01-31'),
    },
  });
  console.log('✔ construction permit BBMP/LP/2026/0412 (max ground coverage 30%)');

  if (process.argv.includes('--no-scan')) return;

  console.log('\n🛰  Running AI monitoring agent …');
  for (const [b, a] of [[0, 1], [1, 2]]) {
    const r = await scanProperty(plot.id, { beforeImageId: images[b].id, afterImageId: images[a].id, trigger: 'SEED' });
    console.log(`\n▶ ${images[b].capturedAt.toISOString().slice(0, 10)} → ${images[a].capturedAt.toISOString().slice(0, 10)}  risk=${r.overallRisk} (${r.mode})`);
    console.log('  ' + r.summary);
    for (const al of r.alerts) console.log(`  🚨 [${al.severity}] ${al.title}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
