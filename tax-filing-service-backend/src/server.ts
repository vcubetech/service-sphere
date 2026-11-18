import 'dotenv/config';
import app from './app';
import { prisma } from './config/prisma';

const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () =>
  console.log(`Tax Filing API running at http://localhost:${port}`),
);

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
