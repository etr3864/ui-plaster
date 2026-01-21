/**
 * TTS Text Normalizer (AI Micro-Module)
 * Converts chat text to TTS-optimized Hebrew
 */

import { callOpenAI } from "../openai/client";
import { logger } from "../utils/logger";

const NORMALIZATION_PROMPT = `You are a Hebrew speech normalizer for TTS (Text-to-Speech).

Your job: Convert chat-style Hebrew text into natural spoken Hebrew.

Rules:
1. Write ALL numbers in Hebrew words (15 → "חמש עשרה", 2025 → "אלפיים עשרים וחמש")
2. Remove ALL emojis completely
3. Convert English words to Hebrew equivalents when possible
4. Fix abbreviations to full words (כ"כ → "כל כך", וכו' → "וכן הלאה")
5. Natural Hebrew speech patterns - conversational and friendly
6. Remove asterisks, special symbols, markdown
7. Add natural pauses with commas where needed
8. Keep the tone warm and personal
9. If there's a URL or link, say "יש לך קישור בהודעה"

Return ONLY the normalized text, nothing else.`;

/**
 * Normalize text for TTS using AI
 * Fast, intelligent conversion for Hebrew speech
 * @param text - Original chat text
 * @returns Normalized text ready for TTS
 */
export async function normalizeForTTS(text: string): Promise<string> {
  const startTime = Date.now();

  try {
    const messages = [
      {
        role: "system" as const,
        content: NORMALIZATION_PROMPT,
      },
      {
        role: "user" as const,
        content: text,
      },
    ];

    const normalized = await callOpenAI(messages, {
      model: "gpt-4o-mini", // Fast and cheap for this task
      maxTokens: 300,
      temperature: 0.3, // Low temp for consistency
    });

    const durationMs = Date.now() - startTime;

    if (!normalized) {
      logger.warn("  AI normalization empty - using basic cleanup");
      return basicNormalization(text);
    }

    logger.info(" Text normalized", {
      chars: `${text.length} → ${normalized.length}`,
      time: `${durationMs}ms`,
    });

    return normalized.trim();
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.warn("  Normalization failed - using basic cleanup", {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });

    // Fallback: Basic cleanup if AI fails
    return basicNormalization(text);
  }
}

/**
 * Fallback: Basic text cleanup without AI
 * Used when AI normalization fails
 */
function basicNormalization(text: string): string {
  return (
    text
      // Remove emojis (basic regex)
      .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
      .replace(/[\u{2600}-\u{26FF}]/gu, "")
      // Remove special symbols
      .replace(/[*_~`]/g, "")
      // Clean whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

