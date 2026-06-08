# Baby Product Category Taxonomy

Reconciled category taxonomy for the Japanese baby-product price-comparison app,
derived from the baby departments of Amazon JP and Rakuten.

> **Data provenance:** Both the Amazon and Rakuten sections below are
> **knowledge-derived**, NOT live-observed. The Chrome DevTools MCP browser
> could not be used during this task: a Chrome instance was already running and
> holding the MCP profile (`~/.cache/chrome-devtools-mcp/chrome-profile`), and
> the MCP server was unable to attach to it. Every `new_page` / `navigate_page` /
> `list_pages` call failed at the browser-launch level with
> "The browser is already running ... Use --isolated" — i.e. a hard environment
> block before any page could load, not a captcha or bot-detection block.
> Attempts were made against both `node=344812011` (Amazon) and the isolated
> context, all failing identically. The category lists below therefore reflect
> the well-known, standard baby-product sub-categories that Amazon JP's
> ベビー&マタニティ department and Rakuten's ベビー・キッズ・マタニティ genre
> expose, enumerated from knowledge of Japanese baby e-commerce. The **Frozen
> taxonomy** is the load-bearing output and is reliable regardless.

## Amazon

Amazon JP ベビー&マタニティ (Baby & Maternity) department — sub-categories
(knowledge-derived):

- おむつ — diapers
- おしりふき — baby wipes
- 粉ミルク・液体ミルク — formula (powdered / liquid milk)
- 哺乳びん・授乳用品 — bottles & feeding supplies
- 離乳食・ベビーフード — baby food / weaning food
- ベビーカー — strollers
- 抱っこひも・スリング — baby carriers & slings
- チャイルドシート — car seats / child seats
- ベビースキンケア — baby skincare
- お風呂・スキンケア用品（沐浴） — bath & infant bathing
- ベビー服 — baby clothing
- おもちゃ・知育 — toys / educational
- ベビーベッド・寝具 — cribs & bedding
- マタニティ（妊婦向け） — maternity (for the mother)
- 安全グッズ・ベビーゲート — safety goods / baby gates

## Rakuten

Rakuten ベビー・キッズ・マタニティ (Baby / Kids / Maternity) genre — sub-genres
(knowledge-derived):

- おむつ — diapers
- おしりふき — baby wipes
- ミルク（粉ミルク・液体ミルク） — formula (powdered / liquid milk)
- 哺乳びん・授乳用品 — bottles & feeding supplies
- ベビーフード・離乳食 — baby food / weaning food
- ベビーカー — strollers
- 抱っこひも・おんぶひも — baby carriers
- チャイルドシート・ジュニアシート — car seats / junior seats
- ベビースキンケア・ベビーローション — baby skincare
- お風呂・ベビーバス（沐浴） — bath / baby bathtub
- ベビー服・子供服 — baby & kids clothing
- おもちゃ・知育玩具 — toys / educational toys
- ベビー寝具・ベビーベッド — baby bedding & cribs
- マタニティ・授乳服 — maternity & nursing wear
- ベビー食器 — baby tableware
- ベビー安全用品・ベビーゲート — baby safety goods / gates

## Frozen taxonomy

Reconciled snake_case keys (overlaps merged across both sites; mother-only
maternity wear, clothing/toys, and furniture dropped as unlikely
product-comparison queries — except `car_seats` and `bath`, which both sites
prominently expose as consumer-purchase items):

- diapers — おむつ — diapers
- wipes — おしりふき — baby wipes
- formula — 粉ミルク・液体ミルク — formula (powdered / liquid milk)
- bottles — 哺乳びん・授乳用品 — baby bottles & feeding supplies
- baby_food — 離乳食・ベビーフード — baby food / weaning food
- carriers — 抱っこひも — baby carriers
- strollers — ベビーカー — strollers
- car_seats — チャイルドシート — car seats / child seats
- skincare — ベビースキンケア — baby skincare
- bath — お風呂・沐浴用品 — bath & infant bathing supplies
