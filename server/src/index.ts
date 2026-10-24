import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { buildApp } from './app.ts';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const { app } = buildApp({
  dbPath: process.env.DB_PATH ?? resolve(here, '../data/ascendant.db'),
  staticDir: process.env.STATIC_DIR ?? resolve(here, '../../client/dist'),
  logger: true,
});

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
