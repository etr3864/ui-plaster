/**
 * Audio transcription using OpenAI Whisper
 */

import OpenAI from "openai";
import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

/**
 * Transcribe audio file from URL using Whisper
 * @param audioUrl Public URL of the audio file
 * @returns Transcribed text
 */
export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  try {
    logger.info(" Transcribing audio...");

    // Download audio file
    const audioResponse = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    // Create a File-like object from the buffer
    const audioBuffer = Buffer.from(audioResponse.data as ArrayBuffer);
    const audioFile = new File([audioBuffer], "audio.ogg", {
      type: audioResponse.headers["content-type"] || "audio/ogg",
    });

    // Send to Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "he", // Hebrew by default, Whisper will auto-detect if needed
    });

    const text = transcription.text.trim();

    if (text) {
      logger.info(` Transcription: "${text}"`);
      return text;
    }

    logger.warn("  Transcription returned empty text");
    return null;
  } catch (error) {
    logger.error(" Transcription failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

