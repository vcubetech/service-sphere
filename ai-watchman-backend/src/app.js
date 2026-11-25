import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import monitoringRoutes from './routes/monitoring.js';
import changeRoutes from './routes/changes.js';
import alertRoutes from './routes/alerts.js';
import reportRoutes from './routes/reports.js';
import satelliteRoutes from './routes/satellite.js';

const corsOrigin = env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
const openapi = YAML.load(fileURLToPath(new URL('../docs/openapi.yaml', import.meta.url)));

const app = express();

app.use(helmet());
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

// Public routes
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'AI Watchman API', timestamp: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));

// Authenticated routes
app.use('/api', authenticate);
app.use('/api/properties', propertyRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/changes', changeRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/satellite', satelliteRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
