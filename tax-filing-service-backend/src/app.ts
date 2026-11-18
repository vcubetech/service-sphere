import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';

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

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
  }),
);

const healthCheck = (_req: express.Request, res: express.Response) =>
  res.json({ status: 'ok', service: 'tax-filing-api' });

app.get(['/health', '/api/health'], healthCheck);
app.get('/openapi.json', (_req, res) => res.json(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.use('/api/auth', auth);
app.use('/api/customers', customers);
app.use('/api/auditors', auditors);
app.use('/api/tax-returns', taxReturns);
app.use('/api/documents', documents);
app.use('/api/audits', audits);
app.use('/api/payments', payments);
app.use('/api/admin', admin);
app.use(notFound);
app.use(errorHandler);

export default app;
