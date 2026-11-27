import { createApp } from './app.js';
import { config, llmEnabled } from './config/index.js';
import { prisma } from './db/prisma.js';
import { startScheduler } from './jobs/scheduler.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`🛰  Smart Property AI API on http://localhost:${config.port}`);
  console.log(`   LLM: ${llmEnabled ? config.llm.model : 'disabled -> rules-only alerts, hashing embeddings'}`);
  startScheduler();
});

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `✖ Port ${config.port} is already in use — another server instance is probably running.\n` +
      `  Stop it, or set a different PORT in .env.`
    );
  } else {
    console.error('✖ Server failed to start:', err);
  }
  await prisma.$disconnect();
  process.exit(1);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
