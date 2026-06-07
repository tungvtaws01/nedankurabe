const FETCH_TIMEOUT_MS = 5000

/**
 * Fetches a URL through ScraperAPI when SCRAPER_API_KEY is set,
 * otherwise falls back to a direct fetch with a 5-second timeout.
 * Using ScraperAPI routes through residential IPs that bypass bot detection
 * on Rakuten and Amazon search pages.
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const key = process.env.SCRAPER_API_KEY
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)

  if (key) {
    const proxyUrl = `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}`
    return fetch(proxyUrl, { ...init, signal })
  }
  return fetch(url, { ...init, signal })
}

export function hasProxy(): boolean {
  return !!process.env.SCRAPER_API_KEY
}
