const DIRECT_TIMEOUT_MS = 5000
const PROXY_TIMEOUT_MS = 25000  // scrape.do typically responds in 5-15s

export interface ProxyOptions {
  render?: boolean     // true = enable JS rendering (needed for Super DEAL, coupons)
  timeoutMs?: number  // override default timeout (default: 25s; use 40s+ for render=true)
}

/**
 * Fetches a URL through scrape.do when SCRAPEDO_TOKEN is set.
 * - render=true enables headless browser rendering, bypassing Rakuten's Akamai bot protection
 * - Only charges for successful responses (no wasted credits on blocks/timeouts)
 * - Falls back to direct fetch when no token is configured
 */
export async function proxyFetch(
  url: string,
  init?: RequestInit,
  options?: ProxyOptions,
): Promise<Response> {
  const token = process.env.SCRAPEDO_TOKEN

  if (token) {
    const signal = AbortSignal.timeout(options?.timeoutMs ?? PROXY_TIMEOUT_MS)
    let proxyUrl = `https://api.scrape.do?token=${token}&url=${encodeURIComponent(url)}`
    // super=true routes through residential/mobile proxies — required for Rakuten's Akamai protection.
    // Without it, scrape.do uses datacenter IPs which Rakuten blocks with ROTATION_FAILED.
    if (options?.render) proxyUrl += '&render=true&super=true'
    // Forward the caller's request headers (notably Accept-Language: ja-JP) to the
    // target. scrape.do only passes headers through when customHeaders=true; without
    // this, Amazon.co.jp localized to ENGLISH (the proxy's default locale), so titles
    // came back as "Pampers Diapers, Tape, M Size..." instead of Japanese — which
    // forced semanticMatch into fragile cross-language matching. Render calls pass no
    // headers, so they are unaffected.
    const headers = init?.headers
    if (headers) {
      proxyUrl += '&customHeaders=true'
      return fetch(proxyUrl, { signal, headers })
    }
    return fetch(proxyUrl, { signal })
  }

  const signal = AbortSignal.timeout(DIRECT_TIMEOUT_MS)
  return fetch(url, { ...init, signal })
}

export function hasProxy(): boolean {
  return !!process.env.SCRAPEDO_TOKEN
}
