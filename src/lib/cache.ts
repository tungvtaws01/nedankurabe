import { createHash } from 'crypto'
import { kv } from '@vercel/kv'

const TTL = 1800

export function makeCacheKey(input: string): string {
  const normalized = input.toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}

export async function getCached<T>(key: string): Promise<T | null> {
  const raw = await kv.get<string>(key)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export async function setCached<T>(key: string, value: T): Promise<void> {
  await kv.set(key, JSON.stringify(value), { ex: TTL })
}
