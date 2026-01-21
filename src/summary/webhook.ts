import { config } from "../config";
import { logger } from "../utils/logger";
import { SummaryPayload } from "./types";

export async function sendSummaryToWebhook(payload: SummaryPayload): Promise<boolean> {
  if (!config.summaryWebhookUrl) {
    logger.warn("[SUMMARY] Webhook URL not configured");
    return false;
  }

  try {
    const response = await fetch(config.summaryWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error("[SUMMARY] Webhook failed", {
        status: response.status,
        phone: payload.phone,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error("[SUMMARY] Webhook error", {
      error: error instanceof Error ? error.message : String(error),
      phone: payload.phone,
    });
    return false;
  }
}
