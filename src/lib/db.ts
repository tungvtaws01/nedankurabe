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
const g = globalThis as unknown as { __pgPool?: Pool }
export const pool =
  g.__pgPool ?? (g.__pgPool = new Pool({ connectionString, max: process.env.USE_UNPOOLED ? 4 : 10 }))

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows as T[]
}
