// Ingest markdown / text documents from docs/knowledge into the pgvector RAG store.
//   node scripts/ingest-docs.js [folder]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db/prisma.js';
import { addDocument } from '../src/rag/vectorStore.js';
import { llmEnabled } from '../src/config/index.js';

const dir = path.resolve(process.argv[2] || 'docs/knowledge');

async function main() {
  console.log(`Embeddings: ${llmEnabled ? 'OpenAI-compatible' : 'offline hashing (set OPENAI_API_KEY for semantic embeddings)'}`);
  const files = fs.readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f));
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const title = (text.match(/^# (.+)/m) || [])[1] || f;
    const n = await addDocument({ source: path.parse(f).name, title, text, metadata: { file: f } });
    console.log(`✔ ${f}: ${n} chunks`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
