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

it('returns product id as a JS number, not a string', async () => {
  const id = await upsertProduct({ jan: null, title: 'NUMCHK', brand: null, category: CAT, imageUrl: '' })
  expect(typeof id).toBe('number')
})

// ---------------------------------------------------------------------------
// Unit tests for findAmazonSiblingByRakuten / findMatchByAsin
// These spy on the `query` helper so no real DB connection is needed.
// ---------------------------------------------------------------------------
import * as db from '../db'
import { findAmazonSiblingByRakuten, findMatchByAsin, searchAmazonFromDb, findProductCandidatesByTokens, linkSlugToProduct } from './repo'

describe('findAmazonSiblingByRakuten', () => {
  let querySpy: jest.SpyInstance

  beforeEach(() => {
    querySpy = jest.spyOn(db, 'query')
  })

  afterEach(() => {
    querySpy.mockRestore()
  })

  it('maps a row to the AmazonSibling shape', async () => {
    querySpy.mockResolvedValueOnce([{ asin: 'B0ABC12345', title: 'メリーズ M', image_url: 'https://thumbnail.image.rakuten.co.jp/a.jpg' }])
    const r = await findAmazonSiblingByRakuten('shop:item1')
    expect(r).toEqual({ asin: 'B0ABC12345', productTitle: 'メリーズ M', productImageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg' })
  })

  it('returns null when there is no match', async () => {
    querySpy.mockResolvedValueOnce([])
    expect(await findAmazonSiblingByRakuten('shop:none')).toBeNull()
  })
})

describe('findMatchByAsin', () => {
  let querySpy: jest.SpyInstance

  beforeEach(() => {
    querySpy = jest.spyOn(db, 'query')
  })

  afterEach(() => {
    querySpy.mockRestore()
  })

  it('maps a row including the rakuten sibling code', async () => {
    querySpy.mockResolvedValueOnce([{ title: 'メリーズ M', image_url: 'https://thumbnail.image.rakuten.co.jp/a.jpg', rakuten_code: 'shop:item1' }])
    const r = await findMatchByAsin('B0ABC12345')
    expect(r).toEqual({ productTitle: 'メリーズ M', productImageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg', rakutenItemCode: 'shop:item1' })
  })

  it('returns null when the ASIN is not in the table', async () => {
    querySpy.mockResolvedValueOnce([])
    expect(await findMatchByAsin('B0NONE00000')).toBeNull()
  })
})

describe('searchAmazonFromDb', () => {
  let querySpy: jest.SpyInstance
  beforeEach(() => { querySpy = jest.spyOn(db, 'query') })
  afterEach(() => { querySpy.mockRestore() })

  it('tokenizes the keyword into AND-ed ILIKE params and maps rows', async () => {
    querySpy.mockResolvedValueOnce([
      { asin: 'B0ABC12345', title: 'パンパース テープ Sサイズ', image_url: 'https://thumbnail.image.rakuten.co.jp/a.jpg' },
    ])
    const r = await searchAmazonFromDb('パンパース テープ')
    expect(r).toEqual([{ asin: 'B0ABC12345', productTitle: 'パンパース テープ Sサイズ', productImageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg' }])
    const [, params] = querySpy.mock.calls[0]
    expect(params).toEqual(['%パンパース%', '%テープ%', 10])
  })

  it('returns [] for an empty/whitespace keyword without querying', async () => {
    expect(await searchAmazonFromDb('   ')).toEqual([])
    expect(querySpy).not.toHaveBeenCalled()
  })
})

describe('findProductCandidatesByTokens', () => {
  let querySpy: jest.SpyInstance
  beforeEach(() => { querySpy = jest.spyOn(db, 'query') })
  afterEach(() => querySpy.mockRestore())

  it('matches space-insensitively on textual tokens only (drops size tokens)', async () => {
    querySpy.mockResolvedValue([
      { product_id: 1, target_title: '明治 ほほえみ らくらくキューブ 27g×30袋', image_url: 'i', target_id: 'A1' },
    ])
    const out = await findProductCandidatesByTokens('明治ほほえみ らくらくキューブ 27g', 'amazon')
    const [sql, params] = querySpy.mock.calls[0]
    // space-insensitive comparison on the title column
    expect(sql).toMatch(/regexp_replace\(p\.title/)
    // textual tokens bound space-stripped; the size token "27g" is NOT bound
    expect(params).toEqual(['%明治ほほえみ%', '%らくらくキューブ%', 'amazon', 20])
    expect(out).toEqual([{ productId: 1, title: '明治 ほほえみ らくらくキューブ 27g×30袋', imageUrl: 'i', targetListingId: 'A1' }])
  })

  it('returns the TARGET listing title (lt.title), not the Rakuten products.title', async () => {
    // A bad harvest pair: the product (Rakuten-sourced) title says 2個セット (1,620g) but the
    // linked Amazon listing is a single 810g box. The card links to the Amazon ASIN, so its
    // title + size must come from the Amazon listing, not the product row.
    querySpy.mockResolvedValue([
      { product_id: 1956, target_title: '明治ほほえみ らくらくキューブ 810g (27g×30袋)', image_url: 'i', target_id: 'B0G2RVD9RS' },
    ])
    const out = await findProductCandidatesByTokens('明治ほほえみ らくらくキューブ', 'amazon')
    const [sql] = querySpy.mock.calls[0]
    expect(sql).toMatch(/lt\.title\s+AS\s+target_title/)
    expect(out[0].title).toBe('明治ほほえみ らくらくキューブ 810g (27g×30袋)')
    expect(out[0].targetListingId).toBe('B0G2RVD9RS')
  })

  it('returns [] and does not query for an all-size/empty keyword', async () => {
    expect(await findProductCandidatesByTokens('780g ×2', 'amazon')).toEqual([])
    expect(querySpy).not.toHaveBeenCalled()
  })

  it('drops count tokens with a 入/入り suffix (60袋入) so size variants still match', async () => {
    querySpy.mockResolvedValue([])
    await findProductCandidatesByTokens('明治ほほえみ らくらくキューブ 60袋入', 'amazon')
    const [, params] = querySpy.mock.calls[0]
    // "60袋入" must be dropped — only the textual brand/line tokens are bound
    expect(params).toEqual(['%明治ほほえみ%', '%らくらくキューブ%', 'amazon', 20])
  })
})

describe('linkSlugToProduct', () => {
  it('upserts a listing row with matchSource=llm and packCount 1', async () => {
    const querySpy = jest.spyOn(db, 'query').mockResolvedValue([])
    await linkSlugToProduct(688, 'rakuten', 'jetprice:x392sh', 'P&G パンパース', 0.8)
    const [sql, params] = querySpy.mock.calls[0]
    expect(sql).toContain('INSERT INTO listings')
    expect(params).toEqual([688, 'rakuten', 'jetprice:x392sh', 'P&G パンパース', 1, 'llm', 0.8, null])
    querySpy.mockRestore()
  })
})
