import { ProductResult } from "@/lib/types";
import { calcRakutenEffectivePrice } from "@/lib/price/normalize";

export function cleanRakutenTitle(title: string): string {
  return title
    .replace(/＼[^／]*／/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/✨[^✨]*✨/g, '')
    .replace(/★[^★]*★/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const EXCLUDE_KEYWORDS = [
  // Trial / sample
  "お試し", "バラ売り", "試供品", "サンプル", "ポイント消化", "お試しセット",
  // Used / defective
  "【中古】", "中古", "訳あり", "ジャンク",
  // Non-purchasable add-ons
  "単品購入不可", "購入者限定",
  // Spare parts / accessories / replacement parts
  "補給部品", "交換パーツ", "交換部品", "替刃", "専用パーツ", "パーツ販売",
  "パッキン", "替えパッキン", "拡張フレーム",
  "替えストロー", "替え ストロー", "専用底板", "底板", "フードセット", "キャップ・フード", "専用プレートレイ",
  // Rental / lease products
  "レンタル", "レンタル延長",
  // ふるさと納税 bundles — tax donation scheme, not regular retail
  "ふるさと納税",
  // Adult-care / non-baby products that shops mis-tag into baby genres (genre pollution).
  // Excluding them from baby matching is correct for both harvest and production search.
  "大人用", "介護", "尿とりパッド", "尿漏れ", "尿もれ", "アテント", "リフレ ",
  "インナーショーツ", "ミエパン", "くろぱん", "見えパン",
  // Household goods mis-tagged into baby genres (laundry racks, hangers, etc.)
  "物干", "洗濯物干", "ハンガー", "突っ張り棒",
  // Non-diaper baby accessories & gifts that pollute the おむつ genre but are not
  // price-comparable disposable-diaper SKUs (changing mats, diaper-cake gifts,
  // generic reusable cloth, bedwetting wear, storage bags). Tokens chosen to be
  // specific enough not to collide with real diaper lines (e.g. さらさらケア is safe
  // vs ケアシート; 夜用パンツ is safe vs おねしょズボン).
  "おむつケーキ", "おむつ替えシート", "おむつ替えマット", "ケアシート",
  "成形布おむつ", "おねしょズボン", "おねしょスカート", "おねしょケット", "収納掛袋",
  // Non-product accessories / equipment that pollute consumable genres: they carry the
  // product noun (哺乳瓶/おしりふき/…) but are stands, racks, holders, cases, lids,
  // cushions, replacement parts, or industrial goods. Compounds avoid colliding with
  // case-packs (ケース品/ケース販売) and legit products (a baby スリング is real — only
  // ワイヤーロープ is industrial pollution).
  "哺乳瓶スタンド", "哺乳瓶ラック", "哺乳瓶ホルダー", "哺乳びんホルダー", "哺乳瓶乾燥", "哺乳びん乾燥",
  "哺乳瓶ケース", "哺乳瓶ボックス", "哺乳瓶ポーチ", "哺乳瓶入れ", "哺乳瓶カバー", "哺乳瓶収納",
  "ボトルスタンド", "乾燥ラック", "水切りラック", "ドライラック",
  "授乳クッション", "授乳枕", "サポートクッション", "セルフミルク", "ミルククッション", "母乳実感パーツ",
  "おしりふきケース", "ウェットシートケース", "おしりふきのフタ", "お尻拭きのフタ",
  "ウェットシートのふた", "シート用フタ", "に貼るフタ", "ビタット", "Bitatto",
  "よだれカバー", "よだれパッド", "ワイヤーロープ",
  // Non-baby pollution that carries a baby leaf genreId (so tier-2 would otherwise
  // mis-map it to a real category): funeral return-gifts, adult incontinence wear,
  // and industrial hardware mis-shelved into baby genres.
  "香典返し", "満中陰志", "粗供養", "法要", "偲草",
  "はくパンツ", "イワツキ", "リブドゥ",
  "化粧ビス", "トラスコ", "フローバル", "異径ユニオン", "カプラ", "ヘックスビット",
];

export function isTrialOrSamplePack(itemName: string): boolean {
  return EXCLUDE_KEYWORDS.some((kw) => itemName.includes(kw));
}

const SEARCH_URL =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401";

// Baby food/formula genres use Japan's reduced 8% consumption tax (軽減税率).
// Points are calculated on tax-excluded price, so divisor must be 1.08 for these.
const FOOD_GENRE_IDS = new Set(["401171", "568293", "213980", "204417"]);

// Maps keyword patterns to Rakuten genreId (verified via IchibaGenre/Search API)
const GENRE_MAP: Array<[RegExp, string]> = [
  [/おむつ|オムツ|紙おむつ/,                                              "205197"], // おむつ
  [/おしりふき|お尻ふき|お尻拭き|おしり拭き/,                              "205194"], // おしりふき
  [/哺乳瓶|哺乳びん|乳首|ニップル/,                                        "205208"], // 哺乳びん・授乳用品
  [/粉ミルク/,                                                             "401171"], // 粉ミルク
  [/液体ミルク/,                                                           "568293"], // 液体ミルク
  [/ブレンダー|ミキサー.*離乳食|離乳食.*ミキサー|フードプロセッサー.*ベビー/, "0"],      // No genre: real blenders live in kitchen, not baby food genre
  [/離乳食|ベビーフード|ハイハイン/,                                        "213980"], // 離乳食・ベビーフード
  [/ストローマグ|コップマグ/,                                              "207753"], // ストローマグ
  [/マグ|ベビー食器|スプーン.*ベビー/,                                     "207750"], // ベビー食器
  [/スタイ|よだれかけ|お食事エプロン/,                                      "407002"], // スタイ・お食事エプロン
  [/ベビーカー/,                                                           "200833"], // ベビーカー
  [/抱っこ紐|抱っこひも|スリング/,                                         "566089"], // 抱っこひも・スリング
  [/チャイルドシート/,                                                     "566088"], // チャイルドシート
  [/歯ブラシ|歯みがき|仕上げ磨き|虫歯/,                                   "551691"], // 歯ブラシ・虫歯ケア
  [/ベビーローション|ベビーオイル|ベビークリーム/,                          "205205"], // ベビーローション・オイル
  [/日焼け止め.*ベビー|ベビー.*日焼け止め/,                                "401166"], // 日焼け止め
  [/メリー|ガラガラ|ラトル|歯固め|プレイジム/,                             "201591"], // ベビー向けおもちゃ
  [/プレイマット|ベビーマット|フロアマット.*ベビー/,                        "566090"], // ベビー用インテリア (prevents cross-category, e.g. pet cages)
  [/バウンサー/,                                                           "213968"], // バウンサー
  [/ベビーチェア|バンボ|ローチェア|ハイチェア.*ベビー/,                    "566882"], // ベビーチェア
];

export function getGenreId(keyword: string): string {
  for (const [pattern, genreId] of GENRE_MAP) {
    if (pattern.test(keyword)) return genreId;
  }
  return "100533"; // Default: キッズ・ベビー・マタニティ (prevents cross-category errors)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseRakutenItem(
  item: any,
  affiliateId: string,
): ProductResult {
  const price: number = item.itemPrice;
  // postageFlag=0: always free. postageFlag=1: shop charges shipping unless item
  // meets their free-shipping threshold. ¥3,980 is the Rakuten standard threshold.
  const shippingCost: number = (item.postageFlag === 0 || price >= 3980) ? 0 : 700;
  const pointRate: number = item.pointRate ?? 1;
  const imageUrl: string = item.smallImageUrls?.[0]?.imageUrl ?? "";
  const itemUrl: string = item.itemUrl ?? "";
  // Food items (baby formula, baby food, snacks) use Japan's reduced 8% consumption tax.
  // Rakuten calculates points on the tax-excluded price, so the divisor must match.
  const taxRate: 1.08 | 1.1 = FOOD_GENRE_IDS.has(String(item.genreId)) ? 1.08 : 1.1;

  const taxExcludedPrice = Math.floor(price / taxRate);
  const pointsEarned = Math.floor((taxExcludedPrice * pointRate) / 100);
  const effectivePrice = calcRakutenEffectivePrice(
    price,
    shippingCost,
    0,
    pointRate,
    1,
    false,
    "off",
    null,
    taxRate,
  );
  const affiliateUrl = affiliateId
    ? `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(itemUrl)}`
    : itemUrl;

  // itemCaption is the seller's product description — truncated to 200 chars for LLM context
  const rawCaption: string = item.itemCaption ?? ''
  const description = rawCaption.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined

  return {
    platform: "rakuten",
    title: cleanRakutenTitle(item.itemName ?? ""),
    description,
    imageUrl,
    shopName: item.shopName ?? "",
    salePrice: price,
    shippingCost,
    couponDiscount: 0,
    pointRate,
    pointsEarned,
    effectivePrice,
    subscribeAvailable: false,
    rakutenCardEligible: true,
    teikiRates: null,
    taxRate,
    affiliateUrl,
  };
}

async function searchRakutenKeyword(
  kw: string,
  appId: string,
  accessKey: string,
  affiliateId: string,
  headers: Record<string, string>,
): Promise<ProductResult[]> {
  const specificGenre = getGenreId(kw);
  // Baby-only scope: search the specific baby genre + 100533 (baby & maternity).
  // No "0" (all-genres) fallback — off-topic queries should return nothing so the
  // UI can show an on-brand "baby products only" empty state.
  const genreFallbacks = specificGenre === "100533"
    ? ["100533"]
    : [specificGenre, "100533"];

  for (const genreId of genreFallbacks) {
    const params = new URLSearchParams({
      applicationId: appId,
      accessKey,
      keyword: kw,
      genreId,
      hits: "10",
      sort: "standard",
    });
    const res = await fetch(`${SEARCH_URL}?${params}`, { headers });
    const body = await res.text();
    console.log("[rakuten:search] kw:", kw.slice(0, 20), "genre:", genreId, "status:", res.status, "body:", body.slice(0, 100));
    if (!res.ok) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = JSON.parse(body) as { Items: Array<{ Item: any }> };
    const filtered = (data.Items ?? [])
      .filter(({ Item }) => !isTrialOrSamplePack(Item.itemName ?? ""))
      .map(({ Item }) => parseRakutenItem(Item, affiliateId));
    if (filtered.length > 0) return filtered;
  }
  return [];
}

export async function searchRakuten(keyword: string): Promise<ProductResult[]> {
  const appId = process.env.RAKUTEN_APP_ID!;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY!;
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID ?? "";
  const normalizedKeyword = keyword.replace(/【[^】]*】/g, " ").replace(/\s+/g, " ").trim();

  const HEADERS = {
    "Referer": "https://nedankurabe.vercel.app/",
    "Origin": "https://nedankurabe.vercel.app",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  // If full keyword returns nothing, retry with first word dropped, then last word dropped.
  // Handles wrong-brand prefix ("和光堂 ハイハイン" → "ハイハイン")
  // and wrong-brand suffix ("ハイハイン 和光堂" → "ハイハイン").
  // Deduplicates: single-word keywords only tried once.
  const parts = normalizedKeyword.split(" ");
  const keywordCandidates = [...new Set([
    normalizedKeyword,
    ...(parts.length >= 2 ? [parts.slice(1).join(" ")] : []),
    ...(parts.length >= 2 ? [parts.slice(0, -1).join(" ")] : []),
  ])];

  for (const kw of keywordCandidates) {
    const results = await searchRakutenKeyword(kw, appId, accessKey, affiliateId, HEADERS);
    if (results.length > 0) return results;
  }
  return [];
}

// Fetch just the Rakuten genreId for a single itemCode. Used by the category
// backfill to recover the structured genre signal for items enumerated before the
// genre_id column existed. Uses the full referrer/origin header set the 20260401
// API requires (a bare Referer 403s on this endpoint).
export async function lookupRakutenGenreId(itemCode: string): Promise<string | null> {
  const appId = process.env.RAKUTEN_APP_ID!
  const accessKey = process.env.RAKUTEN_ACCESS_KEY!
  const params = new URLSearchParams({ applicationId: appId, accessKey, itemCode, hits: '1' })
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: {
      Referer: "https://nedankurabe.vercel.app/",
      Origin: "https://nedankurabe.vercel.app",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  })
  if (!res.ok) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = JSON.parse(await res.text()) as { Items?: Array<{ Item: any }> }
  const gid = data.Items?.[0]?.Item?.genreId
  return gid != null ? String(gid) : null
}

export async function lookupRakuten(
  itemCode: string,
): Promise<ProductResult | null> {
  const appId = process.env.RAKUTEN_APP_ID!;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY!;
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID ?? "";
  const params = new URLSearchParams({
    applicationId: appId,
    accessKey,
    itemCode,
    hits: "1",
  });
  // The 20260401 endpoint 403s on a bare Referer — it needs the full
  // referrer/origin/sec-fetch header set (same as lookupRakutenGenreId).
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: {
      Referer: "https://nedankurabe.vercel.app/",
      Origin: "https://nedankurabe.vercel.app",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { Items: Array<{ Item: unknown }> };
  if (!data.Items?.length) return null;
  return parseRakutenItem(data.Items[0].Item, affiliateId);
}

export interface RawRakutenItem {
  itemCode: string
  itemName: string
  itemCaption?: string
  itemPrice: number
  shopName?: string
  genreId?: string
  smallImageUrls?: { imageUrl: string }[]
}

// One page (max 30 hits) of a genre listing. Page is 1-based; Rakuten caps page at 100.
export async function searchRakutenGenrePage(genreId: string, page: number): Promise<RawRakutenItem[]> {
  const appId = process.env.RAKUTEN_APP_ID!
  const accessKey = process.env.RAKUTEN_ACCESS_KEY!
  const params = new URLSearchParams({
    applicationId: appId, accessKey, genreId,
    hits: '30', page: String(page), sort: 'standard',
  })
  // The 20260401 API rejects requests without the full referrer/origin header set
  // (errorCode 403 REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING) — mirror searchRakuten's headers.
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: {
      Referer: "https://nedankurabe.vercel.app/",
      Origin: "https://nedankurabe.vercel.app",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  })
  if (!res.ok) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = JSON.parse(await res.text()) as { Items: Array<{ Item: any }> }
  return (data.Items ?? []).map(({ Item }) => Item as RawRakutenItem)
}
