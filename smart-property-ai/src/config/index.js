import 'dotenv/config';
import path from 'node:path';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 4000),
  env: process.env.NODE_ENV || 'development',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './data/uploads'),

  llm: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDim: num(process.env.EMBEDDING_DIM, 1536),
  },

  changeDetection: {
    pixelThreshold: num(process.env.CHANGE_PIXEL_THRESHOLD, 40),
    minAreaPx: num(process.env.CHANGE_MIN_AREA_PX, 60),
    analysisWidth: num(process.env.CHANGE_ANALYSIS_WIDTH, 1024),
  },

  monitorCron: process.env.MONITOR_CRON ?? '0 2 * * *',
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
};

export const llmEnabled = Boolean(config.llm.apiKey && !config.llm.apiKey.startsWith('sk-...'));
