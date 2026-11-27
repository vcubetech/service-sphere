// Enables PostGIS + pgvector and (with --indexes) creates spatial / vector indexes
// Usage:  node scripts/init-db.js            -> extensions (run before prisma db push)
//         node scripts/init-db.js --indexes  -> indexes    (run after prisma db push)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const withIndexes = process.argv.includes('--indexes');

const EXTENSIONS = [
  'CREATE EXTENSION IF NOT EXISTS postgis',
  'CREATE EXTENSION IF NOT EXISTS vector',
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_properties_boundary ON properties USING GIST (boundary)',
  'CREATE INDEX IF NOT EXISTS idx_change_regions_geom ON change_regions USING GIST (geom)',
  'CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)',
  // keep area_sqm in sync with the boundary polygon (geodesic area in m²)
  `CREATE OR REPLACE FUNCTION spm_set_area() RETURNS trigger AS $$
   BEGIN
     IF NEW.boundary IS NOT NULL THEN
       NEW.area_sqm := ST_Area(NEW.boundary::geography);
     END IF;
     RETURN NEW;
   END; $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS trg_properties_area ON properties',
  `CREATE TRIGGER trg_properties_area BEFORE INSERT OR UPDATE OF boundary ON properties
   FOR EACH ROW EXECUTE FUNCTION spm_set_area()`,
];

async function main() {
  for (const sql of withIndexes ? INDEXES : EXTENSIONS) {
    await prisma.$executeRawUnsafe(sql);
    console.log('✔', sql.split('\n')[0].slice(0, 90));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
