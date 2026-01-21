import { config } from "../config";
import { logger } from "../utils/logger";
import { getAllPendingSummaries, markSummarySent } from "./tracker";
import { generateSummary } from "./generator";
import { sendSummaryToWebhook } from "./webhook";
import { SummaryPayload } from "./types";

async function processPendingSummaries(): Promise<void> {
  const pending = await getAllPendingSummaries();
  const now = Date.now();
  const delayMs = config.summaryDelayMinutes * 60 * 1000;

  for (const { phone, meta } of pending) {
    const elapsed = now - meta.lastUserMessageAt;
    if (elapsed < delayMs) continue;

    logger.info("[SUMMARY] Generating summary", {
      phone,
      customerName: meta.customerName,
    });

    const summary = await generateSummary(phone, meta.customerName);
    if (!summary) {
      logger.info("[SUMMARY] Skipped - insufficient messages or empty history", { phone });
      continue;
    }

    const payload: SummaryPayload = {
      customerName: meta.customerName,
      phone,
      timestamp: new Date().toISOString(),
      summary,
    };

    const sent = await sendSummaryToWebhook(payload);
    if (sent) {
      await markSummarySent(phone);
      logger.info("[SUMMARY] Summary sent successfully", { phone });
    }
  }
}

export function startSummaryScheduler(): void {
  if (!config.summaryEnabled) {
    logger.info("[SUMMARY] Scheduler disabled");
    return;
  }

  if (!config.summaryWebhookUrl) {
    logger.warn("[SUMMARY] Scheduler disabled - no webhook URL configured");
    return;
  }

  logger.info("[SUMMARY] Scheduler started", {
    delayMinutes: config.summaryDelayMinutes,
    minMessages: config.summaryMinMessages,
  });

  setInterval(() => {
    void processPendingSummaries();
  }, 60_000);
}
