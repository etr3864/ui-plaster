/**
 * OpenAI Client
 * Handles communication with OpenAI API
 */

import OpenAI from "openai";
import { config } from "../config";
import { OpenAIMessage } from "../types/openai";
import { logger } from "../utils/logger";
import { withTimeout } from "../utils/timeout";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

/**
 * Ask OpenAI with given messages
 * @param messages Array of messages (system + history + current)
 * @returns Response text from OpenAI
 */
export async function askOpenAI(messages: OpenAIMessage[]): Promise<string | null> {
  return callOpenAI(messages, {
    model: config.openaiModel,
    maxTokens: config.openaiMaxTokens,
    temperature: config.openaiTemperature,
  });
}

/**
 * Generic OpenAI call with customizable parameters
 * @param messages Array of messages
 * @param options Custom model, temperature, maxTokens
 * @returns Response text from OpenAI
 */
export async function callOpenAI(
  messages: OpenAIMessage[],
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
  }
): Promise<string | null> {
  const {
    model = config.openaiModel,
    maxTokens = config.openaiMaxTokens,
    temperature = config.openaiTemperature,
    timeout = 120000, // 2 minutes default
  } = options || {};

  try {
    const response = await withTimeout(
      openai.chat.completions.create({
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature,
        max_completion_tokens: maxTokens,
      }),
      timeout,
      `OpenAI request timed out after ${timeout / 1000} seconds`
    );

    const content = response.choices[0]?.message?.content;

    if (!content) {
      logger.warn("[AI] Empty response received");
      return null;
    }

    return content;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("timed out")) {
      logger.error("[AI] Request timeout", {
        error: errorMessage,
        timeout,
      });
    } else {
      logger.error("[AI] Error", {
        error: errorMessage,
      });
    }

    return null;
  }
}
