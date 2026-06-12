import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

// Load .env.local into process.env so DB integration tests can connect.
// Mirrors Next.js's env loading; only sets vars that aren't already present.
try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  const parsed = parseEnv(raw) as Record<string, string>
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
} catch {
  // .env.local is optional; tests that need it will fail clearly on connect.
}
