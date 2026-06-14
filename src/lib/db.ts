import { Pool, types } from 'pg'

// Postgres returns BIGINT/BIGSERIAL (OID 20) as strings by default to avoid
// precision loss > 2^53. Our ids are small, so coerce int8 -> number globally.
types.setTypeParser(20, (val) => parseInt(val, 10))

const connectionString = process.env.USE_UNPOOLED
  ? (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL

// Reuse one Pool across HMR reloads / serverless module re-evaluation to avoid
// leaking connections. Scripts (unpooled) are short-lived & single-threaded (max 4);
// the app uses the pooled connection and may serve concurrent requests (max 10).
// Timeouts prevent a query from hanging indefinitely on a stale/dropped connection
// (Neon free-tier drops idle connections; without these a long-running harvest could
// hang for an unbounded time on a single query). statement_timeout cancels server-side,
// query_timeout fails client-side even if the socket is dead, connectionTimeoutMillis
// bounds connection acquisition, idleTimeoutMillis recycles idle clients, keepAlive
// keeps sockets warm. 60s is far above any real query here (largest fetch is ~7k rows).
const g = globalThis as unknown as { __pgPool?: Pool }
export const pool =
  g.__pgPool ?? (g.__pgPool = new Pool({
    connectionString,
    max: process.env.USE_UNPOOLED ? 4 : 10,
    statement_timeout: 60000,
    query_timeout: 60000,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    keepAlive: true,
  }))

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows as T[]
}
