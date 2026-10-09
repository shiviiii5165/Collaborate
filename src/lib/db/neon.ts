import { Pool, neon } from '@neondatabase/serverless';

// Assert production database presence
export function isNeonConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '');
}

export function assertDatabaseAvailable(): void {
  // Allow Next.js build-time page data collection to compile routes
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') {
    return;
  }

  if (process.env.COLLABORATE_ALLOW_LOCAL_STORAGE === 'true') {
    return;
  }

  if (process.env.NODE_ENV === 'production' && !isNeonConfigured()) {
    throw new Error(
      'FATAL: Production database unavailable. DATABASE_URL must be configured with a valid Neon PostgreSQL connection string. Collaborate fails closed to prevent silent data divergence or insecure mock persistence.'
    );
  }
}

let poolInstance: Pool | null = null;

export function getNeonPool(): Pool | null {
  if (!isNeonConfigured()) {
    return null;
  }

  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
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
