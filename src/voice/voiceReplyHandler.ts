/**
 * Voice Reply Handler
 * Central orchestration for voice reply flow
 */

import { logger } from "../utils/logger";
import { VoiceReplyContext } from "./types";
import { shouldUseVoiceReply } from "./voiceDecisionMaker";
import { normalizeForTTS } from "./ttsNormalizer";
import { textToSpeech } from "./elevenLabs";
import { sendVoiceMessage } from "../wa/sendMessage";

/**
 * Main voice reply pipeline
 * Decides, normalizes, converts, and sends voice message
 * @param context - Voice reply context
 * @returns true if voice was sent, false if should fallback to text
 */
export async function handleVoiceReply(context: VoiceReplyContext): Promise<boolean> {
  const startTime = Date.now();

  try {
    // Count user messages in history
    const userMessageCount = context.conversationHistory.filter(
      (msg) => msg.role === "user"
    ).length;

    // Step 1: Decide if voice is appropriate
    const decision = await shouldUseVoiceReply(
      context.phone,
      context.incomingMessageType,
      userMessageCount,
      context.conversationHistory
    );

    if (!decision.shouldUseVoice) {
      return false;
    }

    // Log start with clear indicator
    logger.info(" Voice Reply Pipeline Started", {
      phone: context.phone,
      trigger: decision.reason,
      textPreview: context.responseText.substring(0, 50) + "...",
    });

    // Step 2: Normalize text for TTS
    logger.info(" Normalizing text for TTS...");
    const normalizedText = await normalizeForTTS(context.responseText);

    // Step 3: Convert to speech
    logger.info(" Converting to speech via ElevenLabs...");
    const audioBuffer = await textToSpeech(normalizedText);

    // Step 4: Send voice message
    logger.info(" Sending voice message to WhatsApp...");
    const sent = await sendVoiceMessage(context.phone, audioBuffer);

    if (!sent) {
      logger.error(" Voice send failed - falling back to text");
      return false;
    }

    const totalDurationMs = Date.now() - startTime;

    logger.info(" Voice Reply Complete", {
      phone: context.phone,
      trigger: decision.reason,
      originalChars: context.responseText.length,
      normalizedChars: normalizedText.length,
      audioKB: Math.round(audioBuffer.length / 1024),
      totalMs: totalDurationMs,
    });

    return true;
  } catch (error) {
    const totalDurationMs = Date.now() - startTime;

    logger.error(" Voice Pipeline Failed", {
      phone: context.phone,
      error: error instanceof Error ? error.message : String(error),
      durationMs: totalDurationMs,
      stage: "unknown",
    });

    logger.info("  Falling back to text message");
    return false;
  }
}

/**
 * Quick check: Should we even attempt voice?
 * Used for early pipeline optimization
 */
export function isVoiceReplyPossible(incomingMessageType: string): boolean {
  // Always possible if incoming is voice
  if (incomingMessageType === "audio") {
    return true;
  }

  // Check if feature is enabled in config
  const { voiceRepliesEnabled } = require("../config").config;
  return voiceRepliesEnabled;
}

