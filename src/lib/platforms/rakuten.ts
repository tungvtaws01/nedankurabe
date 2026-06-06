import { ProductResult } from "@/lib/types";
import { calcRakutenEffectivePrice } from "@/lib/price/normalize";

const EXCLUDE_KEYWORDS = ["お試し", "バラ売り", "試供品", "サンプル", "ポイント消化", "お試しセット", "【中古】", "中古", "訳あり", "ジャンク"];

export function isTrialOrSamplePack(itemName: string): boolean {
  return EXCLUDE_KEYWORDS.some((kw) => itemName.includes(kw));
}

const SEARCH_URL =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401";

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
  const params = new URLSearchParams({
    applicationId: appId,
    accessKey,
    keyword: normalizedKeyword,
    hits: "10",
    sort: "+itemPrice",
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: {
      "Referer": "https://nedankurabe.vercel.app/",
      "Origin": "https://nedankurabe.vercel.app",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });
  const body = await res.text();
  console.log("[rakuten:search] status:", res.status, "body:", body.slice(0, 200));
  if (!res.ok) throw new Error(`Rakuten API ${res.status}: ${body}`);
  const data = JSON.parse(body) as { Items: Array<{ Item: any }> };
  return (data.Items ?? [])
    .filter(({ Item }) => !isTrialOrSamplePack(Item.itemName ?? ""))
    .map(({ Item }) => parseRakutenItem(Item, affiliateId));
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
