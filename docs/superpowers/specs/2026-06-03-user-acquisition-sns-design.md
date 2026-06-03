# ねだんくらべ — User Acquisition via SNS Design Spec

**Date:** 2026-06-03
**Status:** Approved
**Product:** ねだんくらべ (price comparison SaaS for Japanese parents)
**Scope:** SNS-based user acquisition using OpenClaw as automated marketer

---

## Overview

Use OpenClaw (external AI agent with browser integration) to manage Facebook, X, and Instagram accounts as a semi-automated marketer. OpenClaw runs a daily batch each morning, prepares 5 post drafts across content pillars, and queues them for a ~10-minute human review before scheduled publishing. Two parallel tracks run simultaneously: building an owned audience (long-term) and driving direct traffic via existing parent communities (short-term).

---

## Decisions Made

| Topic | Decision | Reason |
|---|---|---|
| Tool | OpenClaw (external) | Strong browser integration, no need to build |
| Platforms | Facebook + X + Instagram | All three, content adapted per platform |
| Autonomy | Semi-automated | OpenClaw drafts, human approves daily |
| Content | 5 pillars, not screenshots only | Promotional-only gets banned from groups and killed by algorithms |
| Facebook strategy | Groups, not brand page | Groups have organic reach; brand pages have near-zero reach |
| Link placement | Comment, not post body (FB/Instagram) | Reduces spam filter triggers |
| Long-term channel | LINE OpenChat | Japanese parents trust LINE; shareable within friend networks |

---

## Architecture

```
[Daily Cron — 6:00 AM JST]
        │
        ▼
OpenClaw Agent
  ├─ 1. Product Selection
  │     └─ Browse trending baby/child categories on Amazon JP + Rakuten
  │         (おむつ, ベビーカー, 離乳食, チャイルドシート, etc.)
  │
  ├─ 2. Price Comparison
  │     └─ Call ねだんくらべ API → pick top product with biggest effective price gap
  │
  ├─ 3. Screenshot Capture
  │     └─ Open /results page in browser → capture result card
  │
  ├─ 4. Draft 5 Posts (one per pillar)
  │     ├─ Educational tip (no link)
  │     ├─ Price comparison screenshot (link in comment)
  │     ├─ Community question/poll (no link)
  │     ├─ Trust/explainer (link as reference)
  │     └─ Promotional — 1-2x per week only
  │
  ├─ 5. Adapt per platform
  │     ├─ Instagram: image/carousel + caption + hashtags
  │     ├─ X: short tweet + image (link in body)
  │     └─ Facebook: group post text + image (link in first comment)
  │
  └─ 6. Queue for Review
        └─ Drafts appear in review interface (approve / edit / reject)

[Human Review — ~10 min/day]
        │
        ▼
Approved → Scheduled for posting
  ├─ Instagram: 8:00 AM feed + 12:00 PM Stories
  ├─ X: 7:30 AM / 12:30 PM / 8:00 PM
  └─ Facebook groups: 9:00 AM (rotated across groups)
```

---

## Content Pillars

| Pillar | % of Posts | What OpenClaw Drafts | Link? |
|---|---|---|---|
| Educational tips | 30% | 節約術, coupon stacking, best time to buy baby items | No |
| Price comparison screenshot | 25% | Biggest effective price gap from ねだんくらべ API | In comment (FB/IG) / body (X) |
| Community question | 25% | Engagement polls, open shopping questions | No |
| Trust / explainer | 15% | How effective price is calculated, why points matter | Reference only |
| Promotional | 5% (1–2x/week max) | Direct CTA to try ねだんくらべ | Prominent |

**Example posts by pillar:**

- Educational: "楽天スーパーセール中はポイント5倍になる商品を狙え — 実質価格が大きく変わる"
- Screenshot: "このベビーカー、楽天の方が¥4,200お得でした（ポイント還元込み）"
- Question: "おむつはAmazon定期便 vs 楽天どちらを使ってる？"
- Explainer: "ポイント還元を含めた実質価格とは？計算方法を解説"
- Promotional: "ねだんくらべで今すぐ比較 → [link]"

---

## Platform-Specific Strategy

### Instagram

- **Primary formats:** Carousels (price breakdown slides) + Stories (daily polls/questions)
- **Screenshot posts:** Image-first; link in bio only — no clickable links in captions
- **Hashtags:** `#節約 #育児費 #ママ #Amazon #楽天 #赤ちゃん #子育て #お得情報` (8–12 per post)
- **Frequency:** 1 feed post/day + 1–2 Stories
- **Reels:** Manual only in V1 (screen recording of comparison) — not automated

### X (Twitter)

- **Primary formats:** Short punchy tweet + screenshot image
- **Links:** In tweet body (X algorithm tolerates external links better than FB/IG)
- **Engagement:** Reply to trending parenting hashtags (`#育児` `#ママ友` `#赤ちゃんのいる生活`)
- **Frequency:** 2–3 posts/day (morning / midday / evening JST)
- **Weekly thread:** "今週の節約まとめ" — top 3 deals of the week

### Facebook

- **Target:** Groups, not brand page
- **Link rule:** Link goes in first comment, not the post body — avoids spam filters
- **Target groups:** 節約ママ, ママ友コミュニティ, 育児サポート, Amazon/楽天お得情報グループ
- **Frequency:** 1 post/day across 3–5 groups (rotated; each group gets a post every 3–5 days)
- **Group selection criteria:** Active in last 7 days, 1,000+ members, parent/baby/節約 focus, public or easy-join

---

## Community Strategy

### Track 1 — Community Infiltration (Months 1–2)

Warm up in groups before promoting. OpenClaw follows this sequence per group:

| Weeks | Activity | Goal |
|---|---|---|
| 1–2 | Educational + question posts only, no links | Build reputation and trust |
| 3+ | Price comparison posts with link in first comment | Soft traffic drive |
| Ongoing | Rotate groups, never post same content to all groups same day | Avoid spam flags |

**Risk handling:** OpenClaw flags any group that bans the account. Banned groups are permanently removed from rotation.

### Track 2 — Owned Audience (Months 1–6)

| Month | Milestone |
|---|---|
| 1 | Instagram + X accounts live, daily posting active |
| 2 | 500 Instagram followers; first notable X post |
| 3 | Launch LINE OpenChat (親の節約術) seeded with best content |
| 4–6 | LINE community becomes referral engine; members share deals organically |

LINE OpenChat is the long-term moat — Japanese parents trust LINE, and content shared there reaches friend networks directly.

---

## Review Queue

OpenClaw delivers the daily batch by 6:00 AM JST. Each draft shows:

- Pillar type + platform targets
- Post body text (per platform adaptation)
- Screenshot preview (if applicable)
- Proposed group targets (Facebook)
- Actions: Approve / Edit / Reject

After approval, posts are handed to a scheduler for time-slot distribution.

**OpenClaw also tracks:**
- Group ban flags → removed from rotation automatically
- Engagement on previous posts → weekly summary of top performers
- New candidate groups to join → queued for manual approval, not auto-joined

---

## Success Metrics

| Metric | Month 1 Target | Month 3 Target |
|---|---|---|
| Instagram followers | 200 | 1,000 |
| X followers | 100 | 500 |
| Facebook group posts approved (not banned) | 10 groups active | 15 groups active |
| LINE OpenChat members | — | 100 |
| Daily site visits from SNS | 50 | 300 |

---

## Out of Scope (V1)

- Instagram Reels production (requires manual screen recording)
- Paid advertising (this spec covers organic only)
- Automated engagement (replying to comments) — human handles this
- TikTok (Japanese parent audience smaller there vs. IG/X/FB)
- note.com long-form content (future track)
