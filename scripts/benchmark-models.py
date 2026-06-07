#!/usr/bin/env python3
"""Benchmark OpenRouter models for refineKeyword + semanticMatch tasks."""
import json, time, subprocess, urllib.request, urllib.error, concurrent.futures, sys

# Load API key
env = subprocess.run(['bash', '-c', 'source /Users/tungvu/work/saas/product-matching/.env.local && echo $OPENROUTER_API_KEY'], capture_output=True, text=True)
API_KEY = env.stdout.strip()

# ── Test cases ──────────────────────────────────────────────────────────────

KEYWORD_TESTS = [
    {
        "title": "Ergobaby(エルゴベビー) EBC OMNI Breeze キャメルブラウン SoftFlexメッシュ 通気性 ムレ軽減 人間工学設計 抱っこひも ベビーキャリア 赤ちゃん 日本正規品",
        "platform": "rakuten",
        "must_contain": ["エルゴベビー", "OMNI Breeze", "抱っこ"],
        "must_not": ["EBC", "キャメル", "SoftFlex"],
    },
    {
        "title": "【楽天1位】パンパース テープ Sサイズ 210枚 (54枚×3袋+48枚) 【送料無料】 おむつ 赤ちゃん ランキング1位",
        "platform": "amazon",
        "must_contain": ["パンパース", "テープ"],
        "must_not": ["楽天1位", "送料無料", "ランキング"],
    },
    {
        "title": "明治ほほえみ らくらくキューブ 3,240g (27g×60袋×2)[0ヵ月~1歳頃 固形タイプの粉ミルク]",
        "platform": "rakuten",
        "must_contain": ["明治", "ほほえみ", "らくらくキューブ"],
        "must_not": [],
    },
]

MATCH_TESTS = [
    {
        "source": "Ergobaby(エルゴベビー) EBC OMNI Breeze キャメルブラウン 抱っこひも ¥24,900",
        "candidates": [
            "0: エルゴベビー オムニ ブリーズ(Ergobaby OMNI Breeze) 抱っこひも 日本正規品 ¥19,360",
            "1: エルゴ 抱っこ紐 オムニブリーズ エルゴベビー 抱っこひも ¥19,360",
            "2: コンビ スマートキャリー 抱っこひも ¥15,000",
            "3: DAFI 大人用おしりふき ¥2,000",
        ],
        "expected_match": 0,  # Ergobaby = Ergobaby
    },
    {
        "source": "パンパース テープ Sサイズ 210枚 ¥3,000",
        "candidates": [
            "0: ムーニー テープ Sサイズ 198枚 ¥2,800",
            "1: パンパース テープ Mサイズ 200枚 ¥3,200",
            "2: パンパース テープ Sサイズ 176枚 ¥2,500",
            "3: パンパース パンツ Sサイズ 168枚 ¥2,800",
        ],
        "expected_match": 2,  # same brand+type, closest quantity
    },
    {
        "source": "メリーズ おしりふき 詰替え 70枚×12パック ¥1,500",
        "candidates": [
            "0: DAFI 大人用おしりふき 介護用 60枚 ¥1,200",
            "1: パンパース おしりふき 詰替え 60枚×12 ¥1,400",
            "2: メリーズ おしりふき 詰替え 60枚×10パック ¥1,300",
        ],
        "expected_match": 2,  # same brand Merries, same type
    },
]

KEYWORD_PROMPT = "Search keyword for {platform}. Keep brand+type+model. Remove colors/codes. Max 5 words.\nTitle: {title}"

MATCH_PROMPT = """Match baby product across platforms. Same brand (Ergobaby=エルゴベビー, Pampers=パンパース etc.), same type, baby not adult. Colors may differ. Return {{"match":N}} or {{"match":null}}.
Source: {source}
Candidates:
{candidates}"""

# ── Models to test ───────────────────────────────────────────────────────────
MODELS = [
    # Reasoning models (current)
    "deepseek/deepseek-v4-flash",
    # Fast instruct models - strong multilingual
    "qwen/qwen3-235b-a22b",
    "qwen/qwen3-30b-a3b",
    "qwen/qwen3-8b",
    "google/gemini-flash-1.5",
    "google/gemini-flash-1.5-8b",
    "meta-llama/llama-3.3-70b-instruct",
    "mistralai/mistral-nemo",
    # Free tier
    "meta-llama/llama-3.3-70b-instruct:free",
    "moonshotai/kimi-k2.6:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "openrouter/owl-alpha",
    "google/gemma-4-31b-it:free",
    "openai/gpt-oss-120b:free",
]

def call_llm(model, prompt, max_tokens=500):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0,
    }).encode()
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions',
        data=body,
        method='POST',
        headers={
            'Authorization': f'Bearer {API_KEY}',
            'Content-Type': 'application/json',
        }
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            elapsed = time.time() - t0
            data = json.loads(r.read())
            content = data['choices'][0]['message'].get('content', '') or ''
            return content.strip(), elapsed
    except urllib.error.HTTPError as e:
        elapsed = time.time() - t0
        return f"HTTP_{e.code}", elapsed
    except Exception as e:
        elapsed = time.time() - t0
        return f"ERR:{str(e)[:30]}", elapsed

def score_keyword(result, test):
    if not result or result.startswith(('HTTP_', 'ERR:')):
        return 0, result[:40]
    result_lower = result.lower()
    score = 0
    for must in test['must_contain']:
        if must.lower() in result_lower:
            score += 1
    for bad in test['must_not']:
        if bad.lower() in result_lower:
            score -= 0.5
    max_score = len(test['must_contain'])
    return score / max_score if max_score > 0 else 0, result[:50]

def score_match(result, test):
    if not result or result.startswith(('HTTP_', 'ERR:')):
        return 0, result[:40]
    try:
        # Extract JSON from response
        import re
        m = re.search(r'\{[^}]+\}', result)
        if not m:
            return 0, f"no_json:{result[:30]}"
        parsed = json.loads(m.group())
        match_val = parsed.get('match')
        if match_val is None and test['expected_match'] is None:
            return 1.0, "null✓"
        if match_val == test['expected_match']:
            return 1.0, f"idx{match_val}✓"
        return 0, f"idx{match_val}✗(expected{test['expected_match']})"
    except Exception as e:
        return 0, f"parse_err:{result[:30]}"

def benchmark_model(model):
    results = {'model': model, 'kw_scores': [], 'kw_latencies': [], 'match_scores': [], 'match_latencies': []}

    # Test keyword refinement
    for test in KEYWORD_TESTS:
        prompt = KEYWORD_PROMPT.format(platform=test['platform'], title=test['title'])
        content, elapsed = call_llm(model, prompt, max_tokens=200)
        score, detail = score_keyword(content, test)
        results['kw_scores'].append(score)
        results['kw_latencies'].append(elapsed)
        results[f'kw_detail_{len(results["kw_scores"])-1}'] = detail

    # Test semantic matching
    for test in MATCH_TESTS:
        prompt = MATCH_PROMPT.format(
            source=test['source'],
            candidates='\n'.join(test['candidates'])
        )
        content, elapsed = call_llm(model, prompt, max_tokens=100)
        score, detail = score_match(content, test)
        results['match_scores'].append(score)
        results['match_latencies'].append(elapsed)
        results[f'match_detail_{len(results["match_scores"])-1}'] = detail

    return results

print(f"\n{'='*80}")
print("BENCHMARKING OPENROUTER MODELS — keyword refinement + semantic matching")
print(f"{'='*80}\n")
print(f"{'Model':<45} {'KW Score':>8} {'KW Lat':>8} {'Match':>8} {'M Lat':>8} {'Total':>8}")
print("-" * 90)

all_results = []
for model in MODELS:
    sys.stdout.write(f"  Testing {model[:45]}... ")
    sys.stdout.flush()
    r = benchmark_model(model)
    kw_avg = sum(r['kw_scores']) / len(r['kw_scores'])
    kw_lat = sum(r['kw_latencies']) / len(r['kw_latencies'])
    m_avg = sum(r['match_scores']) / len(r['match_scores'])
    m_lat = sum(r['match_latencies']) / len(r['match_latencies'])
    total_score = (kw_avg + m_avg) / 2
    all_results.append({**r, 'kw_avg': kw_avg, 'kw_lat': kw_lat, 'm_avg': m_avg, 'm_lat': m_lat, 'total': total_score})
    print(f"\r  {model:<45} {kw_avg:>7.1%} {kw_lat:>7.1f}s {m_avg:>7.1%} {m_lat:>7.1f}s {total_score:>7.1%}")

print("\n" + "="*80)
print("RANKING (by total score × speed):")
print("="*80)
def rank_key(r):
    avg_lat = (r['kw_lat'] + r['m_lat']) / 2
    return -(r['total'] * (1 / (1 + avg_lat / 10)))  # penalize latency

all_results.sort(key=rank_key)
for i, r in enumerate(all_results[:10], 1):
    avg_lat = (r['kw_lat'] + r['m_lat']) / 2
    print(f"\n#{i} {r['model']}")
    print(f"   Score: {r['total']:.1%}  Avg latency: {avg_lat:.1f}s  KW={r['kw_avg']:.1%} Match={r['m_avg']:.1%}")
    for j in range(3):
        print(f"   KW{j+1}: {r.get(f'kw_detail_{j}', '')}")
    for j in range(3):
        print(f"   Match{j+1}: {r.get(f'match_detail_{j}', '')}")
