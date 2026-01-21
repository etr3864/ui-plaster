/**
 * Build prompt messages for OpenAI
 */

import { ChatMessage, NormalizedIncoming } from "../types/normalized";
import { OpenAIMessage } from "../types/openai";
import { config } from "../config";
import { askOpenAI } from "../openai/client";
import { saveCustomerInfo, getCustomerInfo } from "./historyManager";
import { formatInTimeZone } from "date-fns-tz";
import { he } from "date-fns/locale";

const ISRAEL_TIMEZONE = "Asia/Jerusalem";

/**
 * Get current date/time in Israel timezone formatted in Hebrew
 */
function getCurrentDateTimeIsrael(): string {
  const now = new Date();
  const dayName = formatInTimeZone(now, ISRAEL_TIMEZONE, "EEEE", { locale: he });
  const date = formatInTimeZone(now, ISRAEL_TIMEZONE, "d.M.yyyy");
  const time = formatInTimeZone(now, ISRAEL_TIMEZONE, "HH:mm");
  return `היום ${dayName}, ${date}, השעה ${time} (שעון ישראל)`;
}

/**
 * Build complete prompt for OpenAI
 */
export async function buildPromptMessages(
  history: ChatMessage[],
  batchMessages: NormalizedIncoming[],
  phone: string
): Promise<OpenAIMessage[]> {
  const messages: OpenAIMessage[] = [];

  // 1. System message with current date/time
  const dateTimeContext = `[${getCurrentDateTimeIsrael()}]\n\n`;
  messages.push({
    role: "system",
    content: dateTimeContext + config.systemPrompt,
  });

  // 2. Conversation history
  for (const msg of history) {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  // 3. Customer info
  const customerInfo = await getOrCreateCustomerInfo(phone, history, batchMessages);

  // 4. Current batch
  const batchContent = formatBatch(batchMessages, customerInfo);
  messages.push({ role: "user", content: batchContent });

  return messages;
}

// ══════════════════════════════════════════════════════════════════
// Customer Info Helpers
// ══════════════════════════════════════════════════════════════════

interface CustomerInfo {
  name: string | null;
  gender: string | null;
}

async function getOrCreateCustomerInfo(
  phone: string,
  history: ChatMessage[],
  batchMessages: NormalizedIncoming[]
): Promise<CustomerInfo> {
  const existing = await getCustomerInfo(phone);
  
  if (existing) {
    return existing;
  }

  const isFirstMessage = history.length === 0;
  if (isFirstMessage && batchMessages.length > 0) {
    const originalName = extractFirstName(batchMessages[0].sender.name);
    if (originalName) {
      const result = await translateNameAndDetectGender(originalName);
      await saveCustomerInfo(phone, result.name, result.gender);
      return result;
    }
  }

  return { name: null, gender: null };
}

// ══════════════════════════════════════════════════════════════════
// Message Formatting Helpers
// ══════════════════════════════════════════════════════════════════

function formatBatch(
  batchMessages: NormalizedIncoming[],
  customerInfo: CustomerInfo
): string {
  const namePrefix = customerInfo.name
    ? `[שם הלקוח: "${customerInfo.name}"${getGenderInstruction(customerInfo.gender)}]\n\n`
    : "";

  if (batchMessages.length === 1) {
    return namePrefix + formatSingleMessage(batchMessages[0]);
  }

  const combined = batchMessages
    .map((msg, i) => `הודעה ${i + 1}:\n${formatSingleMessage(msg)}`)
    .join("\n\n");

  return `${namePrefix}הלקוח שלח מספר הודעות ברצף:\n\n${combined}`;
}

function formatSingleMessage(msg: NormalizedIncoming): string {
  let content = msg.message.text || "";
  if (msg.message.mediaUrl) {
    const label = getMediaTypeLabel(msg.message.type);
    content += `\n\n[${label}: ${msg.message.mediaUrl}]`;
  }
  return content.trim();
}

function getMediaTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    image: "תמונה",
    video: "וידאו",
    audio: "הודעה קולית",
    document: "מסמך",
    sticker: "סטיקר",
  };
  return labels[type] || "מדיה";
}

function extractFirstName(fullName?: string): string | null {
  if (!fullName?.trim()) return null;
  return fullName.trim().split(/\s+/)[0] || null;
}

function getGenderInstruction(gender: string | null): string {
  if (!gender || gender === "לא_ברור") return "";
  if (gender === "זכר") return " (זכר)";
  if (gender === "נקבה") return " (נקבה)";
  return "";
}

// ══════════════════════════════════════════════════════════════════
// Name Translation
// ══════════════════════════════════════════════════════════════════

async function translateNameAndDetectGender(
  name: string
): Promise<{ name: string; gender: string }> {
  const isHebrew = /[\u0590-\u05FF]/.test(name);

  if (isHebrew) {
    try {
      const response = await askOpenAI([
        { role: "system", content: "זהה מגדר לפי שם. השב: זכר, נקבה, או לא_ברור" },
        { role: "user", content: name },
      ]);
      return { name, gender: response?.trim() || "לא_ברור" };
    } catch {
      return { name, gender: "לא_ברור" };
    }
  }

  try {
    const response = await askOpenAI([
      { role: "system", content: "תרגם שם לעברית וזהה מגדר. פורמט: שם|מגדר" },
      { role: "user", content: name },
    ]);
    const [translated, gender] = (response?.trim() || `${name}|לא_ברור`).split("|");
    return {
      name: translated?.trim() || name,
      gender: gender?.trim() || "לא_ברור",
    };
  } catch {
    return { name, gender: "לא_ברור" };
  }
}
