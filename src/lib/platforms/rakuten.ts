import { ProductResult } from "@/lib/types";
import { calcRakutenEffectivePrice } from "@/lib/price/normalize";

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
  "替えストロー", "替え ストロー", "専用底板", "底板", "フードセット", "キャップ・フード",
  // Rental / lease products
  "レンタル", "レンタル延長",
];

export function isTrialOrSamplePack(itemName: string): boolean {
  return EXCLUDE_KEYWORDS.some((kw) => itemName.includes(kw));
}

const SEARCH_URL =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401";

// Maps keyword patterns to Rakuten genreId (verified via IchibaGenre/Search API)
const GENRE_MAP: Array<[RegExp, string]> = [
  [/おむつ|オムツ|紙おむつ/,                                              "205197"], // おむつ
  [/おしりふき|お尻ふき|お尻拭き|おしり拭き/,                              "205194"], // おしりふき
  [/哺乳瓶|哺乳びん|乳首|ニップル/,                                        "205208"], // 哺乳びん・授乳用品
  [/粉ミルク/,                                                             "401171"], // 粉ミルク
  [/液体ミルク/,                                                           "568293"], // 液体ミルク
  [/ブレンダー|ミキサー.*離乳食|離乳食.*ミキサー|フードプロセッサー.*ベビー/, "0"],      // No genre: real blenders live in kitchen, not baby food genre
  [/離乳食|ベビーフード|ハイハイン/,                                        "213980"], // 離乳食・ベビーフード
  [/マグ|ストローマグ|コップマグ|ベビー食器|スプーン.*ベビー/,              "207750"], // ベビー食器
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
  const shippingCost: number = item.postageFlag === 0 ? 0 : 490;
  const pointRate: number = item.pointRate ?? 1;
  const imageUrl: string = item.smallImageUrls?.[0]?.imageUrl ?? "";
  const itemUrl: string = item.itemUrl ?? "";

  const taxExcludedPrice = Math.floor(price / 1.1);
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
  );
  const affiliateUrl = affiliateId
    ? `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(itemUrl)}`
    : itemUrl;

  return {
    platform: "rakuten",
    title: item.itemName ?? "",
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
    affiliateUrl,
  };
}

export async function searchRakuten(keyword: string): Promise<ProductResult[]> {
  const appId = process.env.RAKUTEN_APP_ID!;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY!;
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID ?? "";
  const normalizedKeyword = keyword.replace(/【[^】]*】/g, " ").replace(/\s+/g, " ").trim();
  const specificGenre = getGenreId(normalizedKeyword);
  // Try specific genre first, fall back to baby category (100533), then all genres (0)
  const genreFallbacks = specificGenre === "100533"
    ? ["100533", "0"]
    : [specificGenre, "100533", "0"];

  const HEADERS = {
    "Referer": "https://nedankurabe.vercel.app/",
    "Origin": "https://nedankurabe.vercel.app",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  for (const genreId of genreFallbacks) {
    const params = new URLSearchParams({
      applicationId: appId,
      accessKey,
      keyword: normalizedKeyword,
      genreId,
      hits: "10",
      sort: "+itemPrice",
    });
    const res = await fetch(`${SEARCH_URL}?${params}`, { headers: HEADERS });
    const body = await res.text();
    console.log("[rakuten:search] genre:", genreId, "status:", res.status, "body:", body.slice(0, 150));
    if (!res.ok) continue; // try next genre on error
    const data = JSON.parse(body) as { Items: Array<{ Item: any }> };
    const filtered = (data.Items ?? [])
      .filter(({ Item }) => !isTrialOrSamplePack(Item.itemName ?? ""))
      .map(({ Item }) => parseRakutenItem(Item, affiliateId));
    if (filtered.length > 0) return filtered; // return first genre with results
  }
  return [];
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
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Referer: "https://nedankurabe.vercel.app" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { Items: Array<{ Item: unknown }> };
  if (!data.Items?.length) return null;
  return parseRakutenItem(data.Items[0].Item, affiliateId);
}
