import fs from "fs";
import path from "path";
import { askOpenAI } from "../openai/client";
import { getRedis } from "../db/redis";
import { ChatMessage } from "../types/normalized";
import { config } from "../config";

let summaryPrompt = "";

function loadSummaryPrompt(): string {
  if (summaryPrompt) return summaryPrompt;

  const promptPath = path.join(__dirname, "..", "prompts", "summary_prompt.txt");
  summaryPrompt = fs.readFileSync(promptPath, "utf8");
  return summaryPrompt;
}

async function getConversationHistory(phone: string): Promise<ChatMessage[]> {
  const redis = getRedis();
  if (!redis) return [];

  const data = await redis.get(`chat:${phone}`);
  if (!data) return [];

  const parsed = JSON.parse(data);
  return parsed.history || parsed;
}

function formatHistoryForSummary(history: ChatMessage[], customerName: string): string {
  const lines = history.map((msg) => {
    const role = msg.role === "user" ? customerName : "רוני";
    return `${role}: ${msg.content}`;
  });

  return lines.join("\n");
}

export async function generateSummary(
  phone: string,
  customerName: string
): Promise<string | null> {
  const history = await getConversationHistory(phone);
  if (history.length === 0) return null;

  const userMessages = history.filter((m) => m.role === "user").length;
  if (userMessages < config.summaryMinMessages) return null;

  const prompt = loadSummaryPrompt();
  const formattedHistory = formatHistoryForSummary(history, customerName);

  const fullPrompt = `${prompt}\n\nשם הלקוח: ${customerName}\n\nשיחה:\n${formattedHistory}`;

  const response = await askOpenAI([
    { role: "system", content: "אתה מסכם שיחות בעברית בצורה תמציתית ומקצועית." },
    { role: "user", content: fullPrompt },
  ]);

  return response?.trim() || null;
}
