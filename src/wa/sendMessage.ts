/**
 * Send messages back to WhatsApp via WA Sender API
 */

import axios from "axios";
import { config } from "../config";
import { WASendMessageResponse } from "../types/whatsapp";
import { logger } from "../utils/logger";
import { addHumanDelay } from "../utils/time";
import { uploadAudioToCloudinary, deleteAudioFromCloudinary } from "../voice/cloudinaryUpload";
import { getImage } from "../images/imageCatalog";

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
 * Send image message to WhatsApp user
 * 
 * @param to Phone number to send to
 * @param imageKey Key from IMAGE_CATALOG or direct URL
 * @param caption Optional caption text
 * @param retryCount Current retry attempt
 */
export async function sendImageMessage(
  to: string,
  imageKey: string,
  caption?: string,
  retryCount = 0
): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  try {
    // Get image from catalog or use as direct URL
    const imageInfo = getImage(imageKey);
    const imageUrl = imageInfo?.url || imageKey;
    const finalCaption = caption || imageInfo?.caption;

    // Add human-like delay before sending
    await addHumanDelay();

    // Format phone to E.164 (with +)
    const formattedPhone = to.startsWith("+") ? to : `+${to}`;


    const response = await axios.post<WASendMessageResponse>(
      `${config.waSenderBaseUrl}/send-message`,
      {
        to: formattedPhone,
        text: finalCaption,
        imageUrl,
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

    logger.warn("[IMAGE] Send failed", { error: response.data.error, imageKey });
    return false;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendImageMessage(to, imageKey, caption, retryCount + 1);
    }

    logger.error("[IMAGE] Send error", {
      error: error instanceof Error ? error.message : String(error),
      imageKey,
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
    await addHumanDelay();
    audioUrl = await uploadAudioToCloudinary(audioBuffer);
    const formattedPhone = to.startsWith("+") ? to : `+${to}`;

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

    if (response.data.success) {
      setTimeout(() => {
        void deleteAudioFromCloudinary(audioUrl!);
      }, 120000);
      return true;
    }

    logger.warn("[VOICE] Send failed", { error: response.data.error });

    // Delete immediately on failure (no need to wait)
    if (audioUrl) {
      void deleteAudioFromCloudinary(audioUrl);
    }

    return false;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendVoiceMessage(to, audioBuffer, retryCount + 1);
    }

    if (axios.isAxiosError(error)) {
      logger.error("[VOICE] Send failed", {
        status: error.response?.status,
        error: error.message,
      });
    } else {
      logger.error("[VOICE] Send error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (audioUrl) {
      void deleteAudioFromCloudinary(audioUrl);
    }

    return false;
  }
}
