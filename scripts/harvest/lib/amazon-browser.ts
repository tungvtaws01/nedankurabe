import { chromium, Browser, Page } from 'playwright'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

export class AmazonBrowser {
  private browser!: Browser
  private page!: Page

  async start() {
    this.browser = await chromium.launch({ headless: true })
    const ctx = await this.browser.newContext({ userAgent: UA, locale: 'ja-JP' })
    this.page = await ctx.newPage()
  }
  async stop() { await this.browser?.close() }

  // Returns search-results HTML, or null if a CAPTCHA / robot check is detected.
  // Retries once on navigation failure (transient slow Amazon loads time out at 20s;
  // a single retry recovers most of them instead of stranding the product in 'error').
  async searchHtml(keyword: string): Promise<string | null> {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}&i=baby`
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
        const html = await this.page.content()
        if (/api-services-support@amazon\.com|画像に表示されている文字|enter the characters/i.test(html)) {
          return null // CAPTCHA wall
        }
        return html
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const jitter = (min: number, max: number) => Math.floor(min + Math.random() * (max - min))
