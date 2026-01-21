/**
 * WhatsApp Webhook Handler
 * Receives incoming messages from WA Sender and processes them
 */

import { Request, Response } from "express";
import { WAWebhookPayload, WAMessage } from "../types/whatsapp";
import { logger } from "../utils/logger";
import { config } from "../config";
import { verifyWebhookSignature } from "../utils/webhookAuth";
import { normalizeIncoming, hasMedia } from "./normalize";
import { decryptMedia } from "./decryptMedia";
import { transcribeAudio } from "../openai/transcribe";
import { analyzeImage } from "../openai/vision";
import { addMessageToBuffer } from "../buffer/bufferManager";
import { sendTextMessage } from "./sendMessage";
import { detectOptOut } from "../optout/optOutDetector";
import { isOptedOut, setOptOut, clearOptOut } from "../optout/optOutManager";

// Track processed message IDs to avoid duplicates
const processedMessages = new Set<string>();
const MESSAGE_CACHE_TTL = 60000; // 1 minute
const MAX_PROCESSED_MESSAGES = 10000; // Maximum size before cleanup

/**
 * Clean up old processed messages to prevent memory leak
 * Called when Set grows too large
 */
function cleanupProcessedMessages(): void {
  const currentSize = processedMessages.size;
  
  if (currentSize >= MAX_PROCESSED_MESSAGES) {
    processedMessages.clear();
  }
}

setInterval(() => {
  if (processedMessages.size > 0) {
    processedMessages.clear();
  }
}, 3600000);

/**
 * Handle incoming WhatsApp webhook
 */
export function handleWhatsAppWebhook(req: Request, res: Response): void {
  try {
    const payload = req.body as WAWebhookPayload;

    // Verify webhook signature
    const signature = req.headers["x-webhook-signature"] as string;

    if (!signature) {
      logger.warn("[WEBHOOK] Missing signature - rejecting");
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    // Get raw body for signature verification
    const rawBody = JSON.stringify(req.body);
    const isValid = verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      if (config.skipWebhookVerification) {
        logger.warn("[WEBHOOK] Invalid signature but verification skipped (debug mode)");
      } else {
        logger.error("[WEBHOOK] Invalid signature - rejecting");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    // Respond immediately to WA Sender
    res.status(200).json({ success: true });

    // Process messages asynchronously
    void processWebhook(payload);
  } catch (error) {
    logger.error("Failed to handle webhook", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Still return 200 to avoid WA Sender retry
    res.status(200).json({ success: true });
  }
}

/**
 * Process single message
 * IMPORTANT: All media processing (transcription, analysis) happens HERE
 * before adding to buffer, so timer doesn't expire during processing
 */
async function processMessage(message: WAMessage): Promise<void> {
  // Normalize message
  const normalized = normalizeIncoming(message);
  const phone = normalized.sender.phone;
  const messageText = normalized.message.text;

  // ═════════════════════════════════════════════════════════════════════
  // SMART OPT-OUT SYSTEM
  // ═════════════════════════════════════════════════════════════════════

  // Step 1: Check if customer is currently opted out
  const customerOptedOut = await isOptedOut(phone);

  if (customerOptedOut) {
    logger.info("[OPTOUT] Customer re-engaged", { phone });
    await clearOptOut(phone);
  }

  // Step 2: Check if THIS message is an opt-out request (only for text messages)
  if (messageText) {
    const optOutDetection = await detectOptOut(messageText);

    if (optOutDetection.isOptOut && optOutDetection.confidence !== "low") {
      // Customer wants to opt out!
      await setOptOut(phone, optOutDetection.detectedPhrase);

      await sendTextMessage(
        phone,
        "הבנתי, הסרתי אותך מרשימת התפוצה. אם תרצה לחזור ולשוחח, פשוט שלח לי הודעה בכל עת!"
      );
      logger.info("[OPTOUT] Confirmation sent", { phone });
      return;
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // CONTINUE NORMAL PROCESSING
  // ═════════════════════════════════════════════════════════════════════

  const isAudio = message.message?.audioMessage;
  const isImage = message.message?.imageMessage;

  if (isAudio) {
    logger.info("[MSG] Voice message received", { phone });

    const audioUrl = await decryptMedia(message);
    if (audioUrl) {
      const transcription = await transcribeAudio(audioUrl);
      if (transcription) {
        normalized.message.text = transcription;
        normalized.message.mediaUrl = audioUrl;
        logger.info("[MSG] Transcribed", { phone, text: transcription.substring(0, 50) });
      } else {
        logger.warn("[MSG] Transcription failed", { phone });
        await sendTextMessage(
          normalized.sender.phone,
          "מצטער, לא הצלחתי להבין את ההקלטה הקולית. אנא נסה לשלוח שוב או כתוב בטקסט."
        );
        return;
      }
    } else {
      logger.warn("[MSG] Audio decryption failed", { phone });
      await sendTextMessage(
        normalized.sender.phone,
        "מצטער, נתקלתי בבעיה בקבלת ההקלטה הקולית. אנא נסה לשלוח שוב."
      );
      return;
    }
  } else if (isImage) {
    logger.info("[MSG] Image received", { phone });

    const imageUrl = await decryptMedia(message);
    if (imageUrl) {
      const caption = normalized.message.text;
      const analysis = await analyzeImage(imageUrl, caption);

      if (analysis) {
        const fullText = caption
          ? `[תמונה: ${caption}]\n\nניתוח התמונה: ${analysis}`
          : `[תמונה]\n\nניתוח: ${analysis}`;

        normalized.message.text = fullText;
        normalized.message.mediaUrl = imageUrl;
      } else {
        logger.warn("[MSG] Image analysis failed", { phone });
        
        if (caption) {
          normalized.message.text = `[תמונה: ${caption}]\n\n(לא הצלחתי לנתח את התמונה, אבל ראיתי את הכיתוב)`;
        } else {
          await sendTextMessage(
            normalized.sender.phone,
            "מצטער, לא הצלחתי לנתח את התמונה. אנא נסה לשלוח שוב או תאר במילים מה בתמונה."
          );
          return;
        }
      }
    } else {
      logger.warn("[MSG] Image decryption failed", { phone });
      await sendTextMessage(
        normalized.sender.phone,
        "מצטער, נתקלתי בבעיה בקבלת התמונה. אנא נסה לשלוח שוב."
      );
      return;
    }
  } else {
    logger.info("[MSG] Text received", { phone, text: normalized.message.text?.substring(0, 50) });

    if (hasMedia(message)) {
      const mediaUrl = await decryptMedia(message);
      if (mediaUrl) {
        normalized.message.mediaUrl = mediaUrl;
      }
    }
  }

  // IMPORTANT: Add to buffer ONLY after all processing is complete
  // This ensures timer doesn't expire during transcription/analysis
  addMessageToBuffer(normalized);
}

/**
 * Process webhook payload asynchronously
 */
async function processWebhook(payload: WAWebhookPayload): Promise<void> {
  try {
    // WA Sender sends single message object
    const message = payload.data.messages;

    if (!message) {
      // Silently ignore events without messages
      return;
    }

    // Only log and process actual message events
    const isMessageEvent =
      payload.event === "messages.received" ||
      payload.event === "messages.upsert" ||
      payload.event === "messages-personal.received";

    if (!isMessageEvent) {
      // Ignore other events silently
      return;
    }

    // CRITICAL: Ignore messages sent by the bot itself to prevent infinite loop!
    if (message.key.fromMe === true) {
      // This is a message WE sent, ignore it
      return;
    }

    // Check if we already processed this message (deduplicate)
    const messageId = message.id;
    if (processedMessages.has(messageId)) {
      // Silently ignore duplicate
      return;
    }

    // Check if cleanup needed before adding
    cleanupProcessedMessages();
    
    // Mark as processed
    processedMessages.add(messageId);

    // Auto-cleanup old message IDs after TTL
    setTimeout(() => {
      processedMessages.delete(messageId);
    }, MESSAGE_CACHE_TTL);

    // Log handled by processMessage

    // Process the message
    await processMessage(message);
  } catch (error) {
    logger.error("Failed to process webhook", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
