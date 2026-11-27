import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { config, llmEnabled } from '../config/index.js';

const clientOpts = config.llm.baseURL ? { configuration: { baseURL: config.llm.baseURL } } : {};

export function getChatModel(temperature = 0.1) {
  if (!llmEnabled) return null;
  return new ChatOpenAI({ apiKey: config.llm.apiKey, model: config.llm.model, temperature, ...clientOpts });
}

let _emb;
export function getEmbeddings() {
  if (!llmEnabled) return null;
  _emb ??= new OpenAIEmbeddings({
    apiKey: config.llm.apiKey,
    model: config.llm.embeddingModel,
    dimensions: config.llm.embeddingDim,
    ...clientOpts,
  });
  return _emb;
}

export { llmEnabled };
