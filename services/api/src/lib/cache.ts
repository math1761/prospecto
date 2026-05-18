import type { Env } from "../db/client";

const TTL_ANALYTICS = 60;     // 1 min
const TTL_TEMPLATES = 300;    // 5 min
const TTL_ENRICHMENT = 86400; // 24h
const TTL_DOMAIN_HEALTH = 3600; // 1h

export async function getCached<T>(env: Env, key: string): Promise<T | null> {
  const raw = await env.CACHE.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function setCache(env: Env, key: string, value: unknown, ttl: number): Promise<void> {
  await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

export async function invalidateCache(env: Env, prefix: string): Promise<void> {
  const list = await env.CACHE.list({ prefix });
  await Promise.all(list.keys.map((k) => env.CACHE.delete(k.name)));
}

export { TTL_ANALYTICS, TTL_TEMPLATES, TTL_ENRICHMENT, TTL_DOMAIN_HEALTH };
