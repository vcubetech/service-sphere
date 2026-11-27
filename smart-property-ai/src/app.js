import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import properties from './routes/properties.js';
import { detections, images, construction, alerts, knowledge, agent, dashboard } from './routes/misc.js';
import { bigintJson, errorHandler, notFound } from './middleware/index.js';
import { llmEnabled } from './config/index.js';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './docs/openapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(morgan('dev'));
  app.use(bigintJson);

  app.get('/api/health', (_req, res) => res.json({ ok: true, llm: llmEnabled ? 'enabled' : 'rules-only (no OPENAI_API_KEY)' }));

  app.use('/api/properties', properties);
  app.use('/api/detections', detections);
  app.use('/api/images', images);
  app.use('/api/construction', construction);
  app.use('/api/alerts', alerts);
  app.use('/api/knowledge', knowledge);
  app.use('/api/agent', agent);
  app.use('/api/dashboard', dashboard);

  // API docs: Swagger UI + raw OpenAPI JSON
  app.get('/api/openapi.json', (_req, res) => res.json(openapiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'Smart Property AI — API docs',
    swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true },
  }));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
