import { readFileSync } from 'fs'
import { join } from 'path'
process.env.USE_UNPOOLED = '1'
import { pool } from '../../src/lib/db'

async function main() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
  console.log('[migrate] schema applied')
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
