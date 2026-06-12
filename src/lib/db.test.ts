import { query, pool } from './db'

describe('db', () => {
  afterAll(async () => { await pool.end() })

  it('connects and runs a trivial query', async () => {
    const rows = await query<{ n: number }>('SELECT 1 AS n')
    expect(rows[0].n).toBe(1)
  })
})
