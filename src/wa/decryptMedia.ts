/**
 * Media decryption using WA Sender API
 */

import axios from "axios";
import { config } from "../config";
import { WADecryptMediaResponse, WAMessage } from "../types/whatsapp";
import { logger } from "../utils/logger";

/**
 * Decrypt media file using WA Sender API
 * @param message The full message object containing media
 * @returns Public URL of the decrypted media
 */
export async function decryptMedia(message: WAMessage): Promise<string | null> {
  try {
    // Send the full message structure as required by WA Sender API
    const response = await axios.post<WADecryptMediaResponse>(
      `${config.waSenderBaseUrl}/decrypt-media`,
      {
        data: {
          messages: {
            key: message.key,
            message: message.message,
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.waSenderApiKey}`,
        },
        timeout: 30000, // 30 seconds timeout
      }
    );

    if (response.data.success && response.data.publicUrl) {
      return response.data.publicUrl;
    }

    logger.warn("  Media decryption - no URL returned");
    return null;
  } catch (error) {
    logger.error(" Media decryption failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
