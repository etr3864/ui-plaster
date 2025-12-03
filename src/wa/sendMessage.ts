/**
 * Send messages back to WhatsApp via WA Sender API
 */

import axios from "axios";
import { config } from "../config";
import { WASendMessageResponse } from "../types/whatsapp";
import { logger } from "../utils/logger";
import { addHumanDelay } from "../utils/time";
import { uploadAudioToCloudinary, deleteAudioFromCloudinary } from "../voice/cloudinaryUpload";

/**
 * Send text message to WhatsApp user
 * @param to Phone number to send to
 * @param text Message text
 * @param retryCount Current retry attempt (for 429 handling)
 */
export async function sendTextMessage(
  to: string,
  text: string,
  retryCount = 0
): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  try {
    // Add human-like delay before sending (1.5-3 seconds)
    await addHumanDelay();

    const response = await axios.post<WASendMessageResponse>(
      `${config.waSenderBaseUrl}/send-message`,
      {
        session: "default",
        to: to.includes("@") ? to : `${to}@s.whatsapp.net`,
        text,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.waSenderApiKey}`,
        },
        timeout: 30000,
      }
    );

    if (response.data.success) {
      return true;
    }

    logger.warn("Send failed", {
      error: response.data.error,
      phone: to,
    });
    return false;
  } catch (error) {
    // Retry on 429 (Rate Limit)
    if (axios.isAxiosError(error) && error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      logger.warn(`Rate limited, retrying in ${delay / 1000}s...`, {
        phone: to,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendTextMessage(to, text, retryCount + 1);
    }

    logger.error("Send error", {
      error: error instanceof Error ? error.message : String(error),
      phone: to,
      retryCount,
    });
    return false;
  }
}

/**
 * Send voice message (audio) to WhatsApp user
 * Uploads to Cloudinary temporarily, sends URL to WA Sender, then deletes
 * 
 * @param to Phone number to send to
 * @param audioBuffer Audio buffer (MP3 format from ElevenLabs)
 * @param retryCount Current retry attempt
 */
export async function sendVoiceMessage(
  to: string,
  audioBuffer: Buffer,
  retryCount = 0
): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  let audioUrl: string | null = null;

  try {
    // Add human-like delay before sending
    await addHumanDelay();

    // Upload to Cloudinary
    logger.info("☁️  Uploading audio to Cloudinary...");
    audioUrl = await uploadAudioToCloudinary(audioBuffer);

    // Format phone to E.164 (with +)
    const formattedPhone = to.startsWith("+") ? to : `+${to}`;

    // Debug: Log what we're sending
    logger.info("📤 Sending to WA Sender", {
      to: formattedPhone,
      audioUrl,
      endpoint: `${config.waSenderBaseUrl}/send-message`,
    });
    
    logger.info("🔗 Test this URL in browser:", { audioUrl });

    // Send to WA Sender
    const response = await axios.post<WASendMessageResponse>(
      `${config.waSenderBaseUrl}/send-message`,
      {
        to: formattedPhone,
        audioUrl,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.waSenderApiKey}`,
        },
        timeout: 30000,
      }
    );

    // Debug: Log full response
    logger.info("📥 WA Sender Response", {
      status: response.status,
      data: JSON.stringify(response.data),
    });

    if (response.data.success) {
      logger.info("✅ Voice sent to WhatsApp", {
        audioKB: Math.round(audioBuffer.length / 1024),
      });

      // Delete from Cloudinary after delay (let WA Sender download first)
      setTimeout(() => {
        void deleteAudioFromCloudinary(audioUrl!);
      }, 120000); // 2 minutes delay

      logger.debug("🕐 Audio will be deleted in 2 minutes");

      return true;
    }

    logger.warn("⚠️  Voice send failed", {
      error: response.data.error,
      fullResponse: response.data,
    });

    // Delete immediately on failure (no need to wait)
    if (audioUrl) {
      void deleteAudioFromCloudinary(audioUrl);
    }

    return false;
  } catch (error) {
    // Retry on 429 (Rate Limit)
    if (axios.isAxiosError(error) && error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      logger.warn(`Rate limited on voice, retrying in ${delay / 1000}s...`, {
        phone: to,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendVoiceMessage(to, audioBuffer, retryCount + 1);
    }

    // Log specific error types for debugging
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;

      // Common WA Sender errors with clear messages
      if (status === 413) {
        logger.error("❌ Audio too large (>16MB limit)");
      } else if (status === 400) {
        logger.error("❌ Bad request - check audioUrl format", {
          status,
        });
      } else if (status === 404) {
        logger.error("❌ Endpoint not found - check WA Sender API", {
          status,
        });
      } else {
        logger.error("❌ Voice send failed", {
          status,
          error: error.message,
        });
      }
    } else {
      logger.error("❌ Voice send error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Cleanup Cloudinary on error
    if (audioUrl) {
      void deleteAudioFromCloudinary(audioUrl);
    }

    return false;
  }
}
