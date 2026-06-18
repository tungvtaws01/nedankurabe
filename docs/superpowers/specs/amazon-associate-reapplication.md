# Amazon Associate (nedankurabe-22) — Re-application / Appeal Pack

**Prepared:** 2026-06-17. Use after the compliance rewire is live on https://nedankurabe.vercel.app (it is, as of this date).

## What was wrong, and what is now fixed

The rejection email cited two reasons. Both are now resolved on the live site:

| Rejection reason | Status | What changed |
|---|---|---|
| 1. Amazon trademarks / images / screenshots used without permission | ✅ Fixed | The site no longer displays **any** Amazon-sourced image, screenshot, or price. Product images come only from the Rakuten API; Amazon appears solely as a text/button link ("Amazonで見る"). Verified on prod: a comparison page makes **zero** requests to amazon.co.jp. |
| 2. Special links not using the tracking ID | ✅ Fixed | Every Amazon link now carries `tag=nedankurabe-22`. If no tag is configured, the link is suppressed entirely — it is now impossible to emit an untagged Amazon link. |

Plus: a clear affiliate disclosure now appears on the comparison screen and in the footer.

## Recommended path: Appeal first (異議申し立て)

The rejection email offers two routes:
1. **Appeal (異議申し立て)** via the contact form — references your existing review. **Do this first.**
2. **Fresh re-application** via the Associate signup — fallback if the appeal is declined.

Appeal because the account was "temporarily closed," not permanently banned, and the email explicitly invites an appeal. It reuses your existing ID `nedankurabe-22`.

### How to submit the appeal
1. Go to **https://affiliate.amazon.co.jp/home/contact**
2. In the dropdown, select **「拒否されたアカウントの申し立て」** (Appeal for a rejected account).
3. Paste the message below.

## Appeal message (Japanese — ready to paste)

```
お世話になっております。
アソシエイトID「nedankurabe-22」のアカウント審査につきまして、
異議申し立てをさせていただきたくご連絡いたしました。

ご指摘いただいた2点について、サイト（https://nedankurabe.vercel.app）を
以下のとおり修正いたしましたので、ご報告いたします。

1. 商標・画像の無断使用について
　以前はAmazonの商品画像・価格を当サイト上に表示しておりましたが、
　現在はAmazonの画像・スクリーンショット・価格表示を一切掲載しておりません。
　商品画像は楽天市場のAPIから取得したもののみを使用し、Amazonへは
　テキストリンク（「Amazonで見る」ボタン）のみで誘導しております。

2. トラッキングIDの未使用について
　サイト内のすべてのAmazonへのリンクに、アソシエイトタグ
　（tag=nedankurabe-22）を付与するよう修正いたしました。
　タグを付与できない場合は、リンク自体を表示しない仕様としております。

また、Amazonアソシエイト・プログラムへの参加を明示する開示文を、
比較結果画面およびフッターに掲載しております。

お手数をおかけいたしますが、再審査のほどよろしくお願い申し上げます。

サイトURL: https://nedankurabe.vercel.app
アソシエイトID: nedankurabe-22
氏名: [あなたの氏名]
連絡先メール: [連絡先メール]
```

## Appeal message (English reference)

```
Regarding the review of my Associate account "nedankurabe-22," I would like
to submit an appeal.

I have corrected the site (https://nedankurabe.vercel.app) on the two points raised:

1. Unauthorized use of trademarks/images: The site previously displayed Amazon
   product images and prices. It now displays NO Amazon images, screenshots, or
   prices. Product images are sourced solely from the Rakuten API, and Amazon is
   linked only via a text/button link ("View on Amazon").

2. Tracking ID not used: Every Amazon link on the site now includes the associate
   tag (tag=nedankurabe-22). If a tag cannot be applied, the link is not shown.

A clear disclosure of Amazon Associates participation is shown on the comparison
screen and in the footer.

I kindly request a re-review. Thank you.
```

## Pre-submission checklist (verify before sending)

- [x] Compliant build deployed to production (nedankurabe.vercel.app).
- [x] `AMAZON_PARTNER_TAG=nedankurabe-22` set in Vercel production env.
- [x] Every Amazon link carries `?tag=nedankurabe-22` (verified in browser).
- [x] No Amazon images/prices/screenshots anywhere (verified: zero amazon.co.jp network requests).
- [x] Affiliate disclosure visible on results + footer.
- [ ] **You:** click a few "Amazonで見る" links yourself and confirm they open the correct Amazon product page with the tag in the URL.
- [ ] **You:** submit the appeal via the contact form above.

## Important reality check — the road after approval

Getting the basic account re-approved lets you **create affiliate links**. It does **not** by itself let you display Amazon prices/images again:

- The old PA-API (which the codebase's `platforms/amazon.ts` used) **retired 2026-05-15** and is gone.
- Its replacement, the **Creators API**, requires **≥10 qualified Amazon referral sales in the previous 30 days** before you can access it.
- So Amazon stays "link-only" (no price shown) until you're driving ~10 sales/month. That's why the next phase (a browsable matched-pair catalog, Approach B in the spec) matters — it builds the traffic that produces those sales.

Until then, the compliant link-only model is the correct and only legitimate way to feature Amazon.

## If the appeal is declined

Re-apply fresh at https://affiliate.amazon.co.jp/ with the same compliant site. New accounts get a 180-day window to make 3 qualifying sales to keep the account; focus the catalog/SEO work (Approach B) on driving those.
