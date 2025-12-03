/**
 * Meeting Reminder Scheduler
 * Automatically sends reminders for upcoming meetings
 */

import { getRedis } from "../../db/redis";
import { sendTextMessage } from "../../wa/sendMessage";
import { logger } from "../../utils/logger";
import { config } from "../../config";
import { Meeting } from "../types";
import { diffInMinutes, parseTimeToDate, formatDateYMD, getNowInIsrael } from "./timeUtils";
import { buildDayReminderMessage, buildBeforeReminderMessage } from "./messages";
import { isOptedOut } from "../../optout/optOutManager";

/**
 * Convert Israeli phone format to international for WhatsApp
 */
function toInternationalFormat(phone: string): string {
  if (phone.startsWith("972")) {
    return phone;
  }
  if (phone.startsWith("0")) {
    return "972" + phone.substring(1);
  }
  return "972" + phone;
}

/**
 * Process a single meeting and send reminders if needed
 */
async function processMeeting(key: string, meeting: Meeting): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  // Check if customer opted out - don't send reminders
  const internationalPhone = toInternationalFormat(meeting.phone);
  if (await isOptedOut(internationalPhone)) {
    logger.info("🚫 Skipping reminder - customer opted out", {
      phone: meeting.phone,
      name: meeting.name,
    });
    return;
  }

  const now = getNowInIsrael();
  const meetingDateTime = parseTimeToDate(meeting.time, meeting.date);
  const diffMinutes = diffInMinutes(meetingDateTime, now);

  let updated = false;

  // ===============================================
  // 1️⃣ Day of Meeting Reminder (e.g., 09:00 AM)
  // ===============================================
  const isSameDay = formatDateYMD(now) === meeting.date;
  const targetDayReminderTime = parseTimeToDate(config.reminderDayOfMeetingTime, meeting.date);
  const dayDiff = diffInMinutes(now, targetDayReminderTime);

  if (
    isSameDay &&
    Math.abs(dayDiff) <= config.reminderWindowMinutes &&
    !meeting.flags?.sentDayReminder
  ) {
    logger.info("📨 Sending day-of-meeting reminder", {
      phone: meeting.phone,
      name: meeting.name,
      date: meeting.date,
      time: meeting.time,
    });

    const message = buildDayReminderMessage(meeting);
    const internationalPhone = toInternationalFormat(meeting.phone);
    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      meeting.flags = {
        ...meeting.flags,
        sentDayReminder: true,
        sentBeforeReminder: meeting.flags?.sentBeforeReminder || false,
      };
      updated = true;

      logger.info("✅ Day reminder sent", {
        phone: meeting.phone,
        message: message.substring(0, 50) + "...",
      });
    } else {
      logger.error("❌ Failed to send day reminder", {
        phone: meeting.phone,
      });
    }
  }

  // ===============================================
  // 2️⃣ Minutes Before Meeting Reminder (e.g., 45 min)
  // ===============================================
  if (
    diffMinutes <= config.reminderMinutesBefore &&
    diffMinutes >= config.reminderMinutesBefore - config.reminderWindowMinutes &&
    !meeting.flags?.sentBeforeReminder
  ) {
    logger.info("📨 Sending before-meeting reminder", {
      phone: meeting.phone,
      name: meeting.name,
      date: meeting.date,
      time: meeting.time,
      minutesBefore: config.reminderMinutesBefore,
    });

    const message = buildBeforeReminderMessage(meeting, config.reminderMinutesBefore);
    const internationalPhone = toInternationalFormat(meeting.phone);
    const sent = await sendTextMessage(internationalPhone, message);

    if (sent) {
      meeting.flags = {
        sentDayReminder: meeting.flags?.sentDayReminder || false,
        sentBeforeReminder: true,
      };
      updated = true;

      logger.info("✅ Before-meeting reminder sent", {
        phone: meeting.phone,
        minutesBefore: config.reminderMinutesBefore,
        message: message.substring(0, 50) + "...",
      });
    } else {
      logger.error("❌ Failed to send before-meeting reminder", {
        phone: meeting.phone,
      });
    }
  }

  // Save updated flags back to Redis
  if (updated) {
    await redis.set(key, JSON.stringify(meeting));
    logger.debug("💾 Meeting flags updated", {
      phone: meeting.phone,
      flags: meeting.flags,
    });
  }
}

/**
 * Check all meetings and send reminders
 */
async function checkMeetings(): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) {
      return;
    }

    const keys = await redis.keys("meeting:*");

    if (keys.length === 0) {
      return;
    }

    logger.debug(`🔍 Checking ${keys.length} meetings for reminders`);

    for (const key of keys) {
      try {
        const data = await redis.get(key);
        if (!data) continue;

        const meeting = JSON.parse(data) as Meeting;
        await processMeeting(key, meeting);
      } catch (error) {
        logger.error("❌ Error processing meeting", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error("❌ Reminder scheduler error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Start the meeting reminder scheduler
 * Runs every 60 seconds to check for meetings that need reminders
 */
export function startMeetingReminderScheduler(): void {
  logger.info("⏱️  Meeting Reminder Scheduler Started", {
    dayOfMeetingTime: config.reminderDayOfMeetingTime,
    minutesBefore: config.reminderMinutesBefore,
    windowMinutes: config.reminderWindowMinutes,
    checkInterval: "60 seconds",
  });

  // Run immediately on start
  void checkMeetings();

  // Then run every 60 seconds
  setInterval(() => {
    void checkMeetings();
  }, 60_000); // 60 seconds
}

