/**
 * Send Meeting Confirmation
 * Sends confirmation message to customer after meeting is saved
 * Also adds the message to chat history so the agent knows about it
 */

import { Meeting } from "./types";
import { buildMeetingConfirmationMessage } from "./messageBuilder";
import { sendTextMessage } from "../wa/sendMessage";
import { logger } from "../utils/logger";
import { addToHistory } from "../conversation/historyManager";

/**
 * Convert Israeli phone format (05XXXXXXXX) to international (972XXXXXXXXX)
 * WA Sender API requires international format
 */
function toInternationalFormat(phone: string): string {
  // If already in international format (starts with 972), return as is
  if (phone.startsWith("972")) {
    return phone;
  }
  
  // Convert 05XXXXXXXX to 972XXXXXXXXX
  if (phone.startsWith("0")) {
    return "972" + phone.substring(1);
  }
  
  // Default: assume it needs 972 prefix
  return "972" + phone;
}

/**
 * Send meeting confirmation message to customer
 * This is called once immediately after meeting is saved to Redis
 */
export async function sendMeetingConfirmation(meeting: Meeting): Promise<boolean> {
  try {
    // Build confirmation message
    const message = buildMeetingConfirmationMessage(meeting);

    logger.info(" Sending meeting confirmation", {
      phone: meeting.phone,
      name: meeting.name,
      date: meeting.date,
      time: meeting.time,
    });

    // Convert phone to international format for WhatsApp API
    const internationalPhone = toInternationalFormat(meeting.phone);

    // Send via WhatsApp
    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      // Add to chat history so agent knows about this message
      await addToHistory(internationalPhone, {
        role: "assistant",
        content: message,
        timestamp: Date.now(),
      }, false);

      logger.info(" Meeting confirmation sent and added to history", {
        phone: meeting.phone,
        internationalPhone,
        message: message.substring(0, 50) + "...",
      });
      return true;
    } else {
      logger.error(" Failed to send meeting confirmation", {
        phone: meeting.phone,
        internationalPhone,
      });
      return false;
    }
  } catch (error) {
    logger.error(" Error sending meeting confirmation", {
      error: error instanceof Error ? error.message : String(error),
      phone: meeting.phone,
    });
    return false;
  }
}

