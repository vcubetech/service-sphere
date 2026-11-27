// Embeddings with an offline fallback.
// With an API key -> OpenAI-compatible embeddings.
// Without one     -> deterministic feature-hashing embeddings (bag of words + bigrams),
//                    so RAG retrieval still works for demos / air-gapped installs.
import { getEmbeddings } from '../ai/llm.js';
import { config } from '../config/index.js';

const DIM = config.llm.embeddingDim;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const STOP = new Set('the a an of to in and or for on with is are be by as at from that this it shall any not no'.split(' '));

export function hashingEmbed(text) {
  const v = new Float32Array(DIM);
  const toks = text.toLowerCase().replace(/[^a-z0-9%./ ]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));
  const feats = [...toks, ...toks.slice(1).map((t, i) => `${toks[i]}_${t}`)];
  for (const f of feats) {
    const h = hash(f);
    v[h % DIM] += (h & 1 ? 1 : -1);
  }
  const norm = Math.hypot(...v) || 1;
  return Array.from(v, (x) => x / norm);
}

export async function embedDocuments(texts) {
  const e = getEmbeddings();
  return e ? e.embedDocuments(texts) : texts.map(hashingEmbed);
}

export async function embedQuery(text) {
  const e = getEmbeddings();
  return e ? e.embedQuery(text) : hashingEmbed(text);
}
