/**
 * Voice Decision Maker
 * Intelligent decision: Should this reply be voice or text?
 */

import { config } from "../config";
import { callOpenAI } from "../openai/client";
import { logger } from "../utils/logger";
import { getRedis } from "../db/redis";
import { VoiceReplyDecision } from "./types";

/**
 * Decide if the response should be voice or text
 * @param phone - Customer phone number
 * @param incomingMessageType - Type of incoming message (text, audio, image, etc.)
 * @param userMessageCount - Number of messages from user in conversation
 * @param conversationHistory - Recent conversation context
 * @returns Decision object
 */
export async function shouldUseVoiceReply(
  phone: string,
  incomingMessageType: string,
  userMessageCount: number,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<VoiceReplyDecision> {
  // Feature disabled
  if (!config.voiceRepliesEnabled) {
    return { shouldUseVoice: false, reason: "none" };
  }

  // Rule 1: Always respond with voice if customer sent voice
  if (incomingMessageType === "audio") {
    logger.info(" Voice → Voice: Customer sent audio, replying with voice");
    return { shouldUseVoice: true, reason: "incoming_voice" };
  }

  // Rule 2: Random intelligent voice (once per conversation)
  if (userMessageCount >= config.minMessagesForRandomVoice) {
    const alreadySent = await hasAlreadySentRandomVoice(phone);

    if (alreadySent) {
      return { shouldUseVoice: false, reason: "none" };
    }

    // AI Check: Is this a good moment for voice?
    if (config.randomVoiceAiCheck) {
      logger.info(" Checking if moment is right for voice (AI decision)...");
      const aiDecision = await askAIForVoiceDecision(conversationHistory);

      if (aiDecision) {
        logger.info(" Smart Voice: AI approved - good moment for personal touch", {
          userMessages: userMessageCount,
        });

        // Mark as sent
        await markRandomVoiceSent(phone);

        return { shouldUseVoice: true, reason: "random_intelligent" };
      } else {
        logger.debug(" AI: Not the right moment for voice");
      }
    } else {
      // Simple random without AI (fallback)
      logger.info(" Random Voice: Sending voice (no AI check)", {
        userMessages: userMessageCount,
      });

      await markRandomVoiceSent(phone);
      return { shouldUseVoice: true, reason: "random_intelligent" };
    }
  }

  return { shouldUseVoice: false, reason: "none" };
}

/**
 * AI Micro-Decision: Should we use voice for this reply?
 * Fast GPT call for intelligent context-based decision
 */
async function askAIForVoiceDecision(
  history: Array<{ role: string; content: string }>
): Promise<boolean> {
  const startTime = Date.now();

  try {
    // Build context from last 4 messages
    const recentMessages = history.slice(-4);
    const contextText = recentMessages
      .map((msg) => `${msg.role === "user" ? "לקוח" : "סוכן"}: ${msg.content}`)
      .join("\n");

    const prompt = `אתה מנתח שיחות WhatsApp.

הקשר האחרון:
${contextText}

שאלה: האם התשובה הבאה של הסוכן תתאים יותר כהודעת קול או טקסט?

הודעת קול מתאימה כאשר:
- השיחה חמה ואישית
- יש התלהבות או עניין גבוה
- הלקוח מעורב ושואל שאלות
- הרגע מתאים להוסיף נופך אישי

ענה רקבמילה אחת: "true" (קול) או "false" (טקסט).`;

    const messages = [
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    const response = await callOpenAI(messages, {
      model: "gpt-4o-mini", // Fast decision
      maxTokens: 10,
      temperature: 0.7,
    });

    if (!response) {
      logger.warn("AI decision returned empty, using fallback");
      return Math.random() < 0.3;
    }

    const decision = response.toLowerCase().includes("true");
    const durationMs = Date.now() - startTime;

    logger.debug("AI voice decision completed", {
      decision,
      durationMs,
    });

    return decision;
  } catch (error) {
    logger.error("AI voice decision failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback: Random 30% chance
    return Math.random() < 0.3;
  }
}

/**
 * Check if random voice was already sent in this conversation
 */
async function hasAlreadySentRandomVoice(phone: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return false;

    const key = `customer:${phone}.sentRandomVoice`;
    const value = await redis.get(key);

    return value === "true";
  } catch (error) {
    logger.warn("Failed to check random voice status", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Mark that random voice was sent in this conversation
 * TTL: 7 days (same as conversation history)
 */
async function markRandomVoiceSent(phone: string): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;

    const key = `customer:${phone}.sentRandomVoice`;
    const ttlSeconds = config.redisTtlDays * 24 * 60 * 60;

    await redis.setex(key, ttlSeconds, "true");

    logger.debug("Marked random voice as sent", { phone, ttlDays: config.redisTtlDays });
  } catch (error) {
    logger.warn("Failed to mark random voice status", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

