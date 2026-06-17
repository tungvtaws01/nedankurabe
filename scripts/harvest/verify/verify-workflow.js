export const meta = {
  name: 'verify-matched-pairs',
  description: 'Vision-verify matched Amazon/Rakuten pairs (same physical product?) one agent per shard',
  phases: [{ title: 'Vision verdicts', detail: 'one sonnet vision agent per shard of ~5 pairs' }],
}

// args = either an array of absolute shard paths, or {dir, count} to generate
// dir/shard-NNN.jsonl. The harness may deliver args as a JSON string — parse defensively.
let a = args
if (typeof a === 'string') { try { a = JSON.parse(a) } catch { a = [] } }
let shards = []
if (Array.isArray(a)) shards = a
else if (a && Array.isArray(a.shards)) shards = a.shards
else if (a && a.dir && a.count) {
  for (let i = 0; i < a.count; i++) shards.push(`${a.dir}/shard-${String(i).padStart(3, '0')}.jsonl`)
}
if (!shards.length) { log('no shards passed in args'); return [] }
log(`fanning out over ${shards.length} shards`)

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'confidence', 'mismatch', 'qtyDiffers', 'reason'],
        properties: {
          id: { type: 'number' },
          verdict: { type: 'string', enum: ['KEEP', 'REMOVE', 'UNSURE'] },
          confidence: { type: 'string', enum: ['high', 'low'] },
          mismatch: { type: 'string', enum: ['NONE', 'BRAND', 'LINE', 'TYPE', 'SIZE', 'FLAVOR_SCENT', 'SPF_STAGE', 'WIDTH', 'BUNDLE_CONTENTS', 'OTHER'] },
          qtyDiffers: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

const RUBRIC = `You verify whether two e-commerce listings (Amazon Japan vs Rakuten Japan) are the SAME PRODUCT IDENTITY — the same physical product a shopper would consider identical. Accuracy is critical: a wrong "KEEP" shown to users loses their trust, so when a real mismatch exists you must catch it — but do not invent mismatches the evidence does not support.

For EACH pair: use the Read tool to OPEN BOTH image files (aimg, rimg), look at the package/product, then combine with the titles + descriptions.

The verdict judges PRODUCT IDENTITY ONLY. Quantity is handled separately downstream (a pack_count field normalizes price), so:
- KEEP (verdict=KEEP, mismatch=NONE) when it is the SAME: brand (or an obvious OEM/sub-brand identity visible in the image), product line/series, item TYPE, size/capacity, SPF, stage, flavor, scent.
- Differences that DO NOT change identity → still KEEP: number of packs / bundle COUNT of the SAME unit (1袋 vs 3袋 vs 19個セット of the identical item), color/character/design, limited-edition packaging, minor model-code suffix. When the pack quantity or count differs, set qtyDiffers=true but KEEP if the underlying unit is identical.
- REMOVE when a real identity mismatch exists; set "mismatch" to the PRIMARY one: BRAND, LINE (e.g. 母乳実感 vs 母乳相談室; さらさらケア vs はじめての肌), TYPE (bottle vs nipple vs pump; straw-mug vs bottle; toothpaste vs toothbrush), SIZE (S vs M; 9-14kg vs 12-22kg), FLAVOR_SCENT, SPF_STAGE, WIDTH (gates/covers of different cm ranges), or BUNDLE_CONTENTS (the two bundles contain DIFFERENT items, or one mixes sizes/flavors the other does not — NOT merely a different count of the same item). Use OTHER only if none fit. A generic no-brand item matched to a branded one is REMOVE/BRAND unless the images clearly show the identical product.
- UNSURE (mismatch=NONE) only if the available image+text is genuinely insufficient to decide.

Prioritize what the IMAGES actually show over the titles when they conflict. One image may be missing — judge on the one present plus the text, with lower confidence. Set qtyDiffers independently of the verdict.`

phase('Vision verdicts')

const results = await parallel(shards.map((shardPath) => () =>
  agent(
    `${RUBRIC}\n\nRead this shard file with the Read tool: ${shardPath}\nIt contains one JSON object per line. For every pair in it, produce a verdict. Return a verdict for EVERY id in the shard.`,
    { label: `verify:${shardPath.split('/').pop()}`, phase: 'Vision verdicts', schema: VERDICT_SCHEMA, model: 'sonnet', agentType: 'general-purpose' },
  ).then((r) => ({ shard: shardPath, verdicts: r?.verdicts ?? [] }))
   .catch(() => ({ shard: shardPath, verdicts: [] }))
))

const flat = results.flatMap((r) => r.verdicts)
log(`collected ${flat.length} verdicts from ${shards.length} shards`)
return flat
