process.env.USE_UNPOOLED = '1'
import { pool } from '../db'
import { upsertProduct, upsertListing, setHarvestState, findListingByPlatformId } from './repo'

const CAT = '__test__'

afterAll(async () => {
  await pool.query(
    `DELETE FROM harvest_state WHERE product_id IN (SELECT id FROM products WHERE category=$1)`, [CAT])
  await pool.query(
    `DELETE FROM listings WHERE product_id IN (SELECT id FROM products WHERE category=$1)`, [CAT])
  await pool.query(`DELETE FROM products WHERE category=$1`, [CAT])
  await pool.end()
})

it('upserts a product and is idempotent on JAN', async () => {
  const id1 = await upsertProduct({ jan: '4902430911573', title: 'A', brand: 'P&G', category: CAT, imageUrl: '' })
  const id2 = await upsertProduct({ jan: '4902430911573', title: 'A2', brand: 'P&G', category: CAT, imageUrl: '' })
  expect(id1).toBe(id2)
})

it('upserts a listing and finds it by platform_id', async () => {
  const productId = await upsertProduct({ jan: null, title: 'B', brand: null, category: CAT, imageUrl: '' })
  await upsertListing({
    productId, platform: 'amazon', platformId: 'B0TEST123', title: 'B amazon',
    packCount: 4, matchSource: 'title-sim', confidence: 0.9,
  })
  const found = await findListingByPlatformId('B0TEST123')
  expect(found?.product_id).toBe(productId)
  expect(found?.pack_count).toBe(4)
})

it('records harvest state', async () => {
  const productId = await upsertProduct({ jan: null, title: 'C', brand: null, category: CAT, imageUrl: '' })
  await setHarvestState(productId, 'enumerated')
  const rows = await pool.query(`SELECT stage FROM harvest_state WHERE product_id=$1`, [productId])
  expect(rows.rows[0].stage).toBe('enumerated')
})
