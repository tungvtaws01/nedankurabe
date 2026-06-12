import { Pool, types } from 'pg'

// Postgres returns BIGINT/BIGSERIAL (OID 20) as strings by default to avoid
// precision loss > 2^53. Our ids are small (well under 2^53), and the repo layer
// and callers treat them as numbers, so coerce int8 -> number globally.
types.setTypeParser(20, (val) => parseInt(val, 10))

// Scripts set USE_UNPOOLED=1 to use the long-lived direct connection.
// The app (serverless) uses the pooled DATABASE_URL.
const connectionString = process.env.USE_UNPOOLED
  ? (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL

export const pool = new Pool({ connectionString, max: process.env.USE_UNPOOLED ? 4 : 1 })

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows as T[]
}
