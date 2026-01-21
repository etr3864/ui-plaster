/**
 * Redis Client
 * Handles connection to Redis for persistent conversation storage
 */

import Redis from "ioredis";
import { config } from "../config";
import { logger } from "../utils/logger";

let redis: Redis | null = null;

/**
 * Initialize Redis connection
 */
export function initRedis(): Redis | null {
  if (!config.redisEnabled) {
    logger.info("📦 Redis disabled - using in-memory storage");
    return null;
  }

  if (!config.redisHost || !config.redisPassword) {
    logger.warn("  Redis credentials missing - falling back to in-memory storage");
    return null;
  }

  try {
    redis = new Redis({
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    redis.on("connect", () => {
      logger.info(" Redis connected", {
        host: config.redisHost,
        port: config.redisPort,
      });
    });

    redis.on("error", (error) => {
      logger.error(" Redis connection error", {
        error: error.message,
      });
    });

    redis.on("close", () => {
      logger.warn("  Redis connection closed");
    });

    return redis;
  } catch (error) {
    logger.error(" Failed to initialize Redis", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get Redis client instance
 */
export function getRedis(): Redis | null {
  return redis;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info("🔌 Redis connection closed");
  }
}

