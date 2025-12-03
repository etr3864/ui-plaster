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
import { sendTextMessage } from "../wa/sendMessage";
import { getRedis } from "../db/redis";
import { handleVoiceReply } from "../voice/voiceReplyHandler";

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

      logger.info(`👤 Saved customer info: "${name}" (${gender})`);
    } catch (error) {
      logger.warn("⚠️  Failed to save customer info to Redis", {
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
      logger.warn("⚠️  Failed to get customer info from Redis", {
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
      logger.warn("⚠️  Failed to get history from Redis, using in-memory", {
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
      logger.warn("⚠️  Failed to save to Redis, using in-memory", {
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
    
    if (history.length > 0) {
      logger.info(`📚 Loaded ${history.length} previous messages from history`);
    }
    
    logger.info(`🤖 Generating response...`);

    // Build prompt messages (system + history + batch)
    const promptMessages = await buildPromptMessages(history, batchMessages, phone);

    // Ask OpenAI
    const response = await askOpenAI(promptMessages);

    if (!response) {
      logger.error("❌ AI failed to generate response - sending fallback");
      
      // Send fallback response to customer instead of leaving them hanging
      const fallbackResponse = "מצטער, נתקלתי בקושי טכני זמני. אנא נסה שוב עוד רגע.";
      const sent = await sendTextMessage(phone, fallbackResponse);
      
      if (sent) {
        logger.info("💬 Sent fallback response due to AI failure");
      }
      
      return;
    }

    // Add batch messages to history as user messages
    for (const msg of batchMessages) {
      const content = formatMessageForHistory(msg);
      await addToHistory(phone, {
        role: "user",
        content,
        timestamp: msg.message.timestamp,
      }, false); // Don't log individual saves
    }

    // Add assistant response to history (always save as text, even if sent as voice)
    await addToHistory(phone, {
      role: "assistant",
      content: response,
      timestamp: Date.now(),
    }, false); // Don't log individual saves
    
    // Single log for all saves (calculate without re-fetching)
    const finalHistorySize = history.length + batchMessages.length + 1;
    logger.info(`💾 Conversation saved (${finalHistorySize} messages in history)`);

    // Attempt voice reply if feature is enabled
    let sentAsVoice = false;
    if (config.voiceRepliesEnabled) {
      try {
        // Detect incoming message type (for voice trigger)
        const incomingType = batchMessages[0]?.message?.type || "text";
        
        sentAsVoice = await handleVoiceReply({
          phone,
          responseText: response,
          incomingMessageType: incomingType,
          conversationHistory: history,
        });
      } catch (error) {
        logger.warn("Voice reply failed, falling back to text", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // If voice was sent successfully, we're done
    if (sentAsVoice) {
      logger.info(`🎤 Voice reply sent: "${response.substring(0, 80)}${response.length > 80 ? "..." : ""}"`);
      console.log("─".repeat(60) + "\n");
      return;
    }

    // Otherwise, send text response (normal flow or fallback)
    const sent = await sendTextMessage(phone, response);

    if (!sent) {
      logger.error("❌ Failed to send message");
    } else {
      logger.info(`💬 Reply: "${response.substring(0, 80)}${response.length > 80 ? "..." : ""}"`);
      console.log("─".repeat(60) + "\n");
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
      logger.warn("⚠️  Failed to clear from Redis, clearing in-memory", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to in-memory
    }
  }

  // Fallback to in-memory
  conversationHistory.delete(phone);
  logger.debug("History cleared from memory", { phone });
}
