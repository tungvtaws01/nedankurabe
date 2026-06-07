import { createHash } from 'crypto'
import { kv } from '@vercel/kv'

const TTL = 1800 // 30 minutes

// In-memory fallback — works when @vercel/kv is not configured.
// Vercel Fluid Compute reuses function instances, so this cache survives
// across warm requests within the same instance (most repeat lookups).
const memCache = new Map<string, { value: string; expires: number }>()

export function makeCacheKey(input: string): string {
  const normalized = input.toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}

export async function getCached<T>(key: string): Promise<T | null> {
  // Check in-memory first (always available, zero latency)
  const mem = memCache.get(key)
  if (mem) {
    if (mem.expires > Date.now()) {
      try { return JSON.parse(mem.value) as T } catch { return null }
    }
    memCache.delete(key)
  }

  // Try KV if configured
  try {
    const raw = await kv.get<string>(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setCached<T>(key: string, value: T): Promise<void> {
  const serialized = JSON.stringify(value)
  // Always write to memory
  memCache.set(key, { value: serialized, expires: Date.now() + TTL * 1000 })
  // Also write to KV if available (shared across instances)
  try {
    await kv.set(key, serialized, { ex: TTL })
  } catch { /* KV not configured — memory cache is the fallback */ }
}
