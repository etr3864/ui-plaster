/**
 * Test Reminders
 * Manual testing endpoint to verify reminders work
 */

import { getRedis } from "../../db/redis";
import { sendTextMessage } from "../../wa/sendMessage";
import { logger } from "../../utils/logger";
import { Meeting } from "../types";
import { buildDayReminderMessage, buildBeforeReminderMessage } from "./messages";

/**
 * Convert Israeli phone format to international
 */
function toInternationalFormat(phone: string): string {
  if (phone.startsWith("972")) return phone;
  if (phone.startsWith("0")) return "972" + phone.substring(1);
  return "972" + phone;
}

/**
 * Send a test day reminder for a specific phone
 */
export async function sendTestDayReminder(phone: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) {
      logger.error(" Redis not available");
      return false;
    }

    const key = `meeting:${phone}`;
    const data = await redis.get(key);

    if (!data) {
      logger.error(" No meeting found for this phone", { phone });
      return false;
    }

    const meeting = JSON.parse(data) as Meeting;
    const message = buildDayReminderMessage(meeting);
    const internationalPhone = toInternationalFormat(phone);

    logger.info(" Sending TEST day reminder", { phone, name: meeting.name });
    
    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      logger.info(" TEST day reminder sent successfully");
      return true;
    } else {
      logger.error(" Failed to send TEST day reminder");
      return false;
    }
  } catch (error) {
    logger.error(" Error sending test reminder", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Send a test before-meeting reminder for a specific phone
 */
export async function sendTestBeforeReminder(phone: string, minutesBefore: number = 45): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) {
      logger.error(" Redis not available");
      return false;
    }

    const key = `meeting:${phone}`;
    const data = await redis.get(key);

    if (!data) {
      logger.error(" No meeting found for this phone", { phone });
      return false;
    }

    const meeting = JSON.parse(data) as Meeting;
    const message = buildBeforeReminderMessage(meeting, minutesBefore);
    const internationalPhone = toInternationalFormat(phone);

    logger.info(" Sending TEST before-meeting reminder", { 
      phone, 
      name: meeting.name,
      minutesBefore 
    });
    
    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      logger.info(" TEST before-meeting reminder sent successfully");
      return true;
    } else {
      logger.error(" Failed to send TEST before-meeting reminder");
      return false;
    }
  } catch (error) {
    logger.error(" Error sending test reminder", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * List all meetings in Redis (for debugging)
 */
export async function listAllMeetings(): Promise<Meeting[]> {
  try {
    const redis = getRedis();
    if (!redis) {
      return [];
    }

    const keys = await redis.keys("meeting:*");
    const meetings: Meeting[] = [];

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        meetings.push(JSON.parse(data));
      }
    }

    return meetings;
  } catch (error) {
    logger.error(" Error listing meetings", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

