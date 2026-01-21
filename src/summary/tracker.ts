import { getRedis } from "../db/redis";
import { SummaryMeta } from "./types";

const META_TTL_DAYS = 7;

function getMetaKey(phone: string): string {
  return `summary:meta:${phone}`;
}

export async function trackUserMessage(
  phone: string,
  customerName: string
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const key = getMetaKey(phone);
  const existing = await getMeta(phone);

  const meta: SummaryMeta = {
    customerName: existing?.customerName || customerName,
    lastUserMessageAt: Date.now(),
    summarySent: false,
  };

  const ttl = META_TTL_DAYS * 24 * 60 * 60;
  await redis.setex(key, ttl, JSON.stringify(meta));
}

export async function getMeta(phone: string): Promise<SummaryMeta | null> {
  const redis = getRedis();
  if (!redis) return null;

  const data = await redis.get(getMetaKey(phone));
  if (!data) return null;

  return JSON.parse(data) as SummaryMeta;
}

export async function markSummarySent(phone: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const meta = await getMeta(phone);
  if (!meta) return;

  const key = getMetaKey(phone);
  const ttl = await redis.ttl(key);

  meta.summarySent = true;
  await redis.setex(key, ttl > 0 ? ttl : META_TTL_DAYS * 24 * 60 * 60, JSON.stringify(meta));
}

export async function getAllPendingSummaries(): Promise<{ phone: string; meta: SummaryMeta }[]> {
  const redis = getRedis();
  if (!redis) return [];

  const keys = await redis.keys("summary:meta:*");
  const results: { phone: string; meta: SummaryMeta }[] = [];

  for (const key of keys) {
    const data = await redis.get(key);
    if (!data) continue;

    const meta = JSON.parse(data) as SummaryMeta;
    if (meta.summarySent) continue;

    const phone = key.replace("summary:meta:", "");
    results.push({ phone, meta });
  }

  return results;
}
