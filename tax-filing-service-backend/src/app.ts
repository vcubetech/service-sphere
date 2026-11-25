import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env';
import admin from './modules/admin/routes';
import auditors from './modules/auditors/routes';
import audits from './modules/audits/routes';
import auth from './modules/auth/routes';
import customers from './modules/customers/routes';
import documents from './modules/documents/routes';
import payments from './modules/payments/routes';
import taxReturns from './modules/returns/routes';
import openapi from './openapi';
import { notFound, errorHandler } from './middleware/errors';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
  }),
);

app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ status: 'ok', service: 'tax-filing-api' });
});
app.get('/openapi.json', (_req, res) => res.json(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

const routes = {
  '/api/auth': auth,
  '/api/customers': customers,
  '/api/auditors': auditors,
  '/api/tax-returns': taxReturns,
  '/api/documents': documents,
  '/api/audits': audits,
  '/api/payments': payments,
  '/api/admin': admin,
};
for (const [path, router] of Object.entries(routes)) {
  app.use(path, router);
}

app.use(notFound);
app.use(errorHandler);

export default app;
