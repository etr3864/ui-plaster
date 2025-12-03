/**
 * ElevenLabs TTS Integration
 * Converts normalized Hebrew text to audio
 */

import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const TTS_TIMEOUT_MS = 30000; // 30 seconds timeout (ElevenLabs can be slow)

/**
 * Convert text to speech using ElevenLabs API
 * @param text - Normalized Hebrew text ready for TTS
 * @returns Audio buffer (MP3 format)
 */
export async function textToSpeech(text: string): Promise<Buffer> {
  const startTime = Date.now();

  try {
    if (!config.elevenLabsApiKey || !config.elevenLabsVoiceId) {
      throw new Error("ElevenLabs API credentials not configured");
    }

    const response = await axios.post(
      `${ELEVENLABS_BASE_URL}/text-to-speech/${config.elevenLabsVoiceId}`,
      {
        text,
        model_id: config.elevenLabsModelId, // Configurable via env
        voice_settings: {
          stability: 0.0,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          "xi-api-key": config.elevenLabsApiKey,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout: TTS_TIMEOUT_MS,
      }
    );

    const audioBuffer = Buffer.from(response.data);
    const durationMs = Date.now() - startTime;

    logger.info("✅ Audio generated", {
      size: `${Math.round(audioBuffer.length / 1024)}KB`,
      time: `${durationMs}ms`,
    });

    return audioBuffer;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (axios.isAxiosError(error)) {
      logger.error("❌ ElevenLabs API error", {
        status: error.response?.status,
        message: error.message,
        durationMs,
      });
    } else {
      logger.error("❌ TTS conversion failed", {
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      });
    }

    throw new Error("Failed to convert text to speech");
  }
}

/**
 * Get available character quota from ElevenLabs
 * Useful for monitoring API usage
 */
export async function getCharacterQuota(): Promise<{ remaining: number; limit: number }> {
  try {
    const response = await axios.get(`${ELEVENLABS_BASE_URL}/user`, {
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
      },
    });

    return {
      remaining: response.data.subscription?.character_count || 0,
      limit: response.data.subscription?.character_limit || 0,
    };
  } catch (error) {
    logger.warn("Failed to get ElevenLabs quota", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { remaining: 0, limit: 0 };
  }
}

