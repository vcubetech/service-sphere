import { env } from './config/env';
import app from './app';
import { prisma } from './config/prisma';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(env.PORT, () =>
  console.log(`Tax Filing API running at http://localhost:${env.PORT}`),
);

let shuttingDown = false;

/** Stops accepting connections, lets in-flight requests finish, then exits. */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  // Don't hang forever on keep-alive connections that never close.
  setTimeout(() => {
    console.error('Shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  try {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
