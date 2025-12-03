/**
 * Cloudinary Audio Upload
 * Uploads audio to Cloudinary temporarily and returns public URL
 */

import { v2 as cloudinary } from "cloudinary";
import { config } from "../config";
import { logger } from "../utils/logger";

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});

/**
 * Upload audio buffer to Cloudinary
 * Returns public URL for WA Sender consumption
 * 
 * @param audioBuffer Audio buffer (MP3 from ElevenLabs)
 * @returns Public URL of uploaded audio
 */
export async function uploadAudioToCloudinary(audioBuffer: Buffer): Promise<string> {
  const startTime = Date.now();

  try {
    // Validate credentials
    if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
      throw new Error("Cloudinary credentials not configured");
    }

    // Convert buffer to base64 data URI for upload
    const base64Audio = audioBuffer.toString("base64");
    const dataUri = `data:audio/mpeg;base64,${base64Audio}`;

    // Upload to Cloudinary as raw file (not video)
    const result = await cloudinary.uploader.upload(dataUri, {
      resource_type: "raw", // Upload as raw file (audio)
      folder: "whatsapp_voice", // Organized folder
      public_id: `voice_${Date.now()}.mp3`, // Unique ID with extension
      overwrite: true,
      type: "upload", // Public upload
      access_mode: "public", // Ensure public access
      invalidate: true, // Invalidate CDN cache
    });

    const durationMs = Date.now() - startTime;

    logger.info("✅ Audio uploaded to Cloudinary", {
      url: result.secure_url,
      size: `${Math.round(audioBuffer.length / 1024)}KB`,
      durationMs,
    });

    return result.secure_url;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error("❌ Cloudinary upload failed", {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });

    throw new Error("Failed to upload audio to Cloudinary");
  }
}

/**
 * Delete audio from Cloudinary after successful send
 * Prevents storage buildup
 * 
 * @param publicUrl Public URL returned from upload
 */
export async function deleteAudioFromCloudinary(publicUrl: string): Promise<void> {
  try {
    // Extract public_id from URL
    // Example: https://res.cloudinary.com/xxx/raw/upload/v123/whatsapp_voice/voice_123.mp3
    const urlParts = publicUrl.split("/");
    const fileName = urlParts[urlParts.length - 1]; // Keep .mp3
    const folder = urlParts[urlParts.length - 2];
    const publicId = `${folder}/${fileName}`;

    await cloudinary.uploader.destroy(publicId, {
      resource_type: "raw", // Match upload type
    });

    logger.debug("🗑️  Audio deleted from Cloudinary", { publicId });
  } catch (error) {
    // Non-critical error - just log it
    logger.warn("⚠️  Failed to delete audio from Cloudinary", {
      error: error instanceof Error ? error.message : String(error),
      url: publicUrl,
    });
  }
}

