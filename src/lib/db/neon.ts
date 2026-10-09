import { Pool as NeonPool } from '@neondatabase/serverless';
import { Pool as PgPool } from 'pg';
import { getPostgresSslOptions } from './ssl';

// Assert production database presence
export function isNeonConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '');
}

export function assertDatabaseAvailable(): void {
  // Allow Next.js build-time page data collection to compile routes
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') {
    return;
  }

  // In cloud deployments (e.g. Vercel, staging, cloud VMs), local storage overrides are strictly forbidden
  const isCloudRuntime = Boolean(
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.AWS_REGION
  );

  if (isCloudRuntime && !isNeonConfigured()) {
    throw new Error(
      'FATAL: Production database unavailable. DATABASE_URL must be configured with a valid PostgreSQL connection string. In public cloud deployments, local storage overrides are strictly forbidden. Collaborate fails closed to prevent silent data divergence or insecure ephemeral persistence.'
    );
  }

  // Local development & test runner override permitted strictly on local developer machines
  if (process.env.COLLABORATE_ALLOW_LOCAL_STORAGE === 'true' && !isCloudRuntime) {
    return;
  }

  if (process.env.NODE_ENV === 'production' && !isNeonConfigured()) {
    throw new Error(
      'FATAL: Production database unavailable. DATABASE_URL must be configured with a valid PostgreSQL connection string. Collaborate fails closed to prevent silent data divergence or insecure mock persistence.'
    );
  }
}

type AnyPool = any;
let poolInstance: AnyPool | null = null;

export function getNeonPool(): AnyPool | null {
  if (!isNeonConfigured()) {
    return null;
  }

  if (!poolInstance) {
    const url = process.env.DATABASE_URL || '';
    if (url.includes('neon.tech')) {
      poolInstance = new NeonPool({
        connectionString: url,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    } else {
      const cleanUrl = url.replace(/[?&]sslmode=[^&]+/g, '').replace(/\?$/, '');
      const sslConfig = getPostgresSslOptions(cleanUrl);
      poolInstance = new PgPool({
        connectionString: cleanUrl,
        ssl: sslConfig,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      poolInstance.on('error', (err: Error) => {
        console.error('[DATABASE_TLS_ERROR] PostgreSQL client connection error:', err.message);
      });
    }
  }

  return poolInstance;
}

export async function queryNeon<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  assertDatabaseAvailable();
  const pool = getNeonPool();
  if (!pool) {
    throw new Error('Database pool not initialized. DATABASE_URL is not set.');
  }

  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function withNeonTransaction<T>(
  callback: (client: any) => Promise<T>
): Promise<T> {
  assertDatabaseAvailable();
  const pool = getNeonPool();
  if (!pool) {
    throw new Error('Database pool not initialized. DATABASE_URL is not set.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
