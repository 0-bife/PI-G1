import { createApp } from './app.js';
import { createDatabase } from './db.js';

const db = createDatabase();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const server = createApp(db).listen(port, host, () => {
  console.log(`InAblink API listening on http://${host}:${port}`);
});

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    try {
      await db.end();
      clearTimeout(timeout);
    } catch {
      process.exitCode = 1;
    }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', async (error: NodeJS.ErrnoException) => {
  console.error('Server failed to start:', error.code);
  await db.end();
  process.exitCode = 1;
});
