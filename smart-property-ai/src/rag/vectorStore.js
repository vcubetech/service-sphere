// pgvector-backed knowledge store for RAG (bye-laws, zoning rules, land-record SOPs...)
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { embedDocuments, embedQuery } from './embeddings.js';
import { chunkText } from './chunker.js';

export { chunkText };

const toVec = (arr) => `[${arr.map((x) => Number(x).toFixed(6)).join(',')}]`;

export async function addDocument({ source, title, text, metadata = {} }) {
  await prisma.knowledgeChunk.deleteMany({ where: { source } }); // re-ingest = replace
  const chunks = chunkText(text);
  const vectors = await embedDocuments(chunks.map((c) => `${title}\n${c.heading || ''}\n${c.content}`));
  for (let i = 0; i < chunks.length; i++) {
    await prisma.$executeRaw`
      INSERT INTO knowledge_chunks (id, source, title, content, metadata, embedding, created_at)
      VALUES (gen_random_uuid()::text, ${source}, ${chunks[i].heading || title}, ${chunks[i].content},
              ${JSON.stringify({ ...metadata, docTitle: title, chunk: i })}::jsonb,
              ${toVec(vectors[i])}::vector, now())`;
  }
  return chunks.length;
}

/** Cosine-similarity search. Optional `sources` filter (array of source ids). */
export async function similaritySearch(query, { k = 5, sources } = {}) {
  const q = toVec(await embedQuery(query));
  const filter = sources?.length ? Prisma.sql`WHERE source = ANY(${sources})` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT id, source, title, content, metadata, 1 - (embedding <=> ${q}::vector) AS score
      FROM knowledge_chunks ${filter}
     ORDER BY embedding <=> ${q}::vector
     LIMIT ${k}`;
  return rows.map((r) => ({ ...r, score: +Number(r.score).toFixed(4) }));
}
