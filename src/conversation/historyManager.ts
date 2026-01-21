/**
 * Conversation History Manager
 *
 * - Maintains conversation history per phone number
 * - Limits history to last N messages (30-40)
 * - Handles batch processing and OpenAI communication
 * - Supports both Redis (persistent) and in-memory (fallback) storage
 */

import { ChatMessage, NormalizedIncoming } from "../types/normalized";
import { config } from "../config";
import { logger } from "../utils/logger";
import { buildPromptMessages } from "./buildPrompt";
import { askOpenAI } from "../openai/client";
import { sendTextMessage, sendImageMessage } from "../wa/sendMessage";
import { getRedis } from "../db/redis";
import { handleVoiceReply } from "../voice/voiceReplyHandler";
import { extractImages } from "../images/imageHandler";
import { trackUserMessage } from "../summary";

// In-memory conversation history per phone number (fallback)
const conversationHistory = new Map<string, ChatMessage[]>();

/**
 * Get Redis key for phone number
 */
function getRedisKey(phone: string): string {
  return `chat:${phone}`;
}

/**
 * Get Redis key for customer metadata
 */
function getCustomerKey(phone: string): string {
  return `customer:${phone}`;
}

/**
 * Save customer metadata (name, gender) permanently
 */
export async function saveCustomerInfo(
  phone: string,
  name: string,
  gender: string
): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getCustomerKey(phone);
      const customerData = JSON.stringify({ name, gender, savedAt: Date.now() });
      
      // Save without TTL (permanent) or with long TTL (1 year)
      const ttlSeconds = 365 * 24 * 60 * 60; // 1 year
      await redis.setex(key, ttlSeconds, customerData);

      logger.debug("[CUSTOMER] Saved info", { name, gender });
    } catch (error) {
      logger.warn("[CUSTOMER] Failed to save to Redis", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Get customer metadata (name, gender)
 */
export async function getCustomerInfo(
  phone: string
): Promise<{ name: string; gender: string } | null> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getCustomerKey(phone);
      const data = await redis.get(key);

      if (data) {
        const parsed = JSON.parse(data);
        return { name: parsed.name, gender: parsed.gender };
      }
    } catch (error) {
      logger.warn("[CUSTOMER] Failed to get from Redis", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

/**
 * Get conversation history for a phone number
 * Uses Redis if available, otherwise falls back to in-memory
 */
export async function getHistory(phone: string): Promise<ChatMessage[]> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getRedisKey(phone);
      const data = await redis.get(key);

      if (data) {
        const history = JSON.parse(data) as ChatMessage[];
        return history;
      }
      return [];
    } catch (error) {
      logger.warn("[HISTORY] Failed to get from Redis, using in-memory", {
        error: error instanceof Error ? error.message : String(error),
      });
      return conversationHistory.get(phone) || [];
    }
  }

  // Fallback to in-memory
  return conversationHistory.get(phone) || [];
}

/**
 * Add message to conversation history
 * Uses Redis if available, otherwise falls back to in-memory
 */
async function addToHistory(phone: string, message: ChatMessage, shouldLog = true): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getRedisKey(phone);
      let history = await getHistory(phone);

      history.push(message);

      // Trim history to max size
      if (history.length > config.maxHistoryMessages) {
        const toRemove = history.length - config.maxHistoryMessages;
        history = history.slice(toRemove);

        if (shouldLog) {
          logger.debug("History trimmed", {
            phone,
            removed: toRemove,
            remaining: history.length,
          });
        }
      }

      // Save to Redis with TTL
      const ttlSeconds = config.redisTtlDays * 24 * 60 * 60;
      await redis.setex(key, ttlSeconds, JSON.stringify(history));

      return;
    } catch (error) {
      logger.warn("[HISTORY] Failed to save to Redis, using in-memory", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to in-memory
    }
  }

  // Fallback to in-memory
  let history = conversationHistory.get(phone);

  if (!history) {
    history = [];
    conversationHistory.set(phone, history);
  }

  history.push(message);

  // Trim history to max size
  if (history.length > config.maxHistoryMessages) {
    const toRemove = history.length - config.maxHistoryMessages;
    history.splice(0, toRemove);

    logger.debug("History trimmed", {
      phone,
      removed: toRemove,
      remaining: history.length,
    });
  }
}

/**
 * Flush conversation - process batch of messages
 * This is called by bufferManager when timer expires
 */
export async function flushConversation(
  phone: string,
  batchMessages: NormalizedIncoming[]
): Promise<void> {
  try {
    // Get existing history
    const history = await getHistory(phone);
    
    logger.info("[AI] Generating response", { historySize: history.length });

    // Build prompt messages (system + history + batch)
    const promptMessages = await buildPromptMessages(history, batchMessages, phone);

    // Ask OpenAI
    const response = await askOpenAI(promptMessages);

    if (!response) {
      logger.error("[AI] Failed to generate response - sending fallback");
      const fallbackResponse = "מצטער, נתקלתי בקושי טכני זמני. אנא נסה שוב עוד רגע.";
      await sendTextMessage(phone, fallbackResponse);
      return;
    }

    // Add batch messages to history as user messages
    for (const msg of batchMessages) {
      const content = formatMessageForHistory(msg);
      await addToHistory(phone, {
        role: "user",
        content,
        timestamp: msg.message.timestamp,
      }, false);
    }

    // Track user message for summary scheduler
    const customerInfo = await getCustomerInfo(phone);
    const customerName = customerInfo?.name || batchMessages[0]?.sender?.name || "לקוח";
    void trackUserMessage(phone, customerName);

    // Add assistant response to history (always save as text, even if sent as voice)
    await addToHistory(phone, {
      role: "assistant",
      content: response,
      timestamp: Date.now(),
    }, false); // Don't log individual saves
    

    // Extract any image tags from response
    const { cleanText, images } = extractImages(response);

    // Attempt voice reply if feature is enabled (only for text, not images)
    let sentAsVoice = false;
    if (config.voiceRepliesEnabled && images.length === 0) {
      try {
        // Detect incoming message type (for voice trigger)
        const incomingType = batchMessages[0]?.message?.type || "text";
        
        sentAsVoice = await handleVoiceReply({
          phone,
          responseText: cleanText,
          incomingMessageType: incomingType,
          conversationHistory: history,
        });
      } catch (error) {
        logger.warn("[VOICE] Failed, falling back to text", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (sentAsVoice) {
      logger.info("[VOICE] Reply sent", { phone });
      return;
    }

    if (cleanText) {
      const sent = await sendTextMessage(phone, cleanText);
      if (!sent) {
        logger.error("[SEND] Failed to send message", { phone });
      } else {
        logger.info("[SEND] Reply sent", { phone });
      }
    }

    for (const image of images) {
      if (cleanText || images.indexOf(image) > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      
      const imageSent = await sendImageMessage(phone, image.key, image.caption);
      if (!imageSent) {
        logger.error("[SEND] Failed to send image", { phone, imageKey: image.key });
      }
    }
  } catch (error) {
    logger.error("Failed to flush conversation", {
      senderPhone: phone,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

/**
 * Format message for history
 * For voice/image: saves transcription/analysis (not URL)
 * For other media: saves URL if no text available
 */
function formatMessageForHistory(msg: NormalizedIncoming): string {
  const text = msg.message.text || "";
  
  // If we have text (transcription/analysis/regular message), use it
  if (text) {
    return text.trim();
  }
  
  // Only if no text and there's media, mention the media URL
  if (msg.message.mediaUrl) {
    return `[מדיה: ${msg.message.mediaUrl}]`;
  }

  return "";
}

/**
 * Clear history for specific phone (for testing/cleanup)
 * Uses Redis if available, otherwise falls back to in-memory
 */
export async function clearHistory(phone: string): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      const key = getRedisKey(phone);
      await redis.del(key);
      logger.debug("History cleared from Redis", { phone });
      return;
    } catch (error) {
      logger.warn("[HISTORY] Failed to clear from Redis", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  conversationHistory.delete(phone);
}
