/**
 * Collaborate. by AI Tathastu — Render API Service Entrypoint
 */

import { buildServer } from './server';
import { isNeonConfigured } from '@/lib/db/neon';
import { formatStartupDiagnostics } from '@/integrations/tathastu/config';
import { getMediaStore } from '@/lib/media/r2';
import { startMediaCleanup } from '@/modules/media/service';

const server = buildServer();
const port = Number(process.env.PORT) || 4000;
const host = '0.0.0.0';

server.listen({ port, host }, (err, address) => {
  if (err) {
    console.error('Fatal error starting Render Fastify server:', err);
    process.exit(1);
  }
  console.log(`[Collaborate Render API Service] Live on ${address}`);
  console.log(`[Database Authority] Authoritative store: ${isNeonConfigured() ? 'PostgreSQL' : 'Local Store'}`);
  // Variable NAMES only; values are never printed.
  for (const line of formatStartupDiagnostics()) console.log(line);
  console.log(`[Media] R2 storage: ${getMediaStore() ? 'configured' : 'not configured (uploads disabled)'}`);
  startMediaCleanup();
});
