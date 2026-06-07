const DIRECT_TIMEOUT_MS = 5000
const PROXY_TIMEOUT_MS = 20000  // ScraperAPI needs more time (3-8s avg)

export interface ProxyOptions {
  render?: boolean  // true = enable JS rendering (uses 5x credits, needed for JS-only content)
}

/**
 * Fetches a URL through ScraperAPI when SCRAPER_API_KEY is set.
 * - Strips custom browser headers when proxying (ScraperAPI handles emulation internally)
 * - Uses country_code=jp for Japanese e-commerce sites
 * - Uses 20s timeout (ScraperAPI typically responds in 3-8s)
 * Falls back to direct fetch with 5s timeout when no key.
 */
export async function proxyFetch(
  url: string,
  init?: RequestInit,
  options?: ProxyOptions,
): Promise<Response> {
  const key = process.env.SCRAPER_API_KEY

  if (key) {
    const signal = AbortSignal.timeout(PROXY_TIMEOUT_MS)
    let proxyUrl = `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}&country_code=jp`
    if (options?.render) proxyUrl += '&render=true'
    // Do NOT pass custom headers — ScraperAPI handles browser emulation internally.
    // Passing conflicting headers causes request failures.
    return fetch(proxyUrl, { signal })
  }

  const signal = AbortSignal.timeout(DIRECT_TIMEOUT_MS)
  return fetch(url, { ...init, signal })
}

export function hasProxy(): boolean {
  return !!process.env.SCRAPER_API_KEY
}
