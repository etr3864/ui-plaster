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
import { addToHistory } from "../../conversation/historyManager";

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

  const internationalPhone = toInternationalFormat(meeting.phone);
  if (await isOptedOut(internationalPhone)) {
    return;
  }

  const now = getNowInIsrael();
  const meetingDateTime = parseTimeToDate(meeting.time, meeting.date);
  const diffMinutes = diffInMinutes(meetingDateTime, now);

  let updated = false;

  const isSameDay = formatDateYMD(now) === meeting.date;
  const targetDayReminderTime = parseTimeToDate(config.reminderDayOfMeetingTime, meeting.date);
  const dayDiff = diffInMinutes(now, targetDayReminderTime);

  if (
    isSameDay &&
    Math.abs(dayDiff) <= config.reminderWindowMinutes &&
    !meeting.flags?.sentDayReminder
  ) {
    const message = buildDayReminderMessage(meeting);
    const intlPhone = toInternationalFormat(meeting.phone);
    const sent = await sendTextMessage(intlPhone, message);

    if (sent) {
      // Add to chat history so agent knows about this reminder
      await addToHistory(intlPhone, {
        role: "assistant",
        content: message,
        timestamp: Date.now(),
      }, false);

      meeting.flags = {
        ...meeting.flags,
        sentDayReminder: true,
        sentBeforeReminder: meeting.flags?.sentBeforeReminder || false,
      };
      updated = true;
      logger.info("[REMINDER] Day reminder sent and added to history", { phone: meeting.phone });
    } else {
      logger.error("[REMINDER] Failed to send day reminder", { phone: meeting.phone });
    }
  }

  if (
    diffMinutes <= config.reminderMinutesBefore &&
    diffMinutes >= config.reminderMinutesBefore - config.reminderWindowMinutes &&
    !meeting.flags?.sentBeforeReminder
  ) {
    const message = buildBeforeReminderMessage(meeting, config.reminderMinutesBefore);
    const intlPhone = toInternationalFormat(meeting.phone);
    const sent = await sendTextMessage(intlPhone, message);

    if (sent) {
      // Add to chat history so agent knows about this reminder
      await addToHistory(intlPhone, {
        role: "assistant",
        content: message,
        timestamp: Date.now(),
      }, false);

      meeting.flags = {
        sentDayReminder: meeting.flags?.sentDayReminder || false,
        sentBeforeReminder: true,
      };
      updated = true;
      logger.info("[REMINDER] Before-meeting reminder sent and added to history", { phone: meeting.phone });
    } else {
      logger.error("[REMINDER] Failed to send before-meeting reminder", { phone: meeting.phone });
    }
  }

  if (updated) {
    await redis.set(key, JSON.stringify(meeting));
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

    for (const key of keys) {
      try {
        const data = await redis.get(key);
        if (!data) continue;

        const meeting = JSON.parse(data) as Meeting;
        await processMeeting(key, meeting);
      } catch (error) {
        logger.error("[REMINDER] Error processing meeting", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error("[REMINDER] Scheduler error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Start the meeting reminder scheduler
 * Runs every 60 seconds to check for meetings that need reminders
 */
export function startMeetingReminderScheduler(): void {
  if (!config.remindersEnabled) {
    logger.info("[REMINDER] Scheduler disabled");
    return;
  }

  logger.info("[REMINDER] Scheduler started", {
    dayOfMeetingTime: config.reminderDayOfMeetingTime,
    minutesBefore: config.reminderMinutesBefore,
  });

  // Run immediately on start
  void checkMeetings();

  // Then run every 60 seconds
  setInterval(() => {
    void checkMeetings();
  }, 60_000); // 60 seconds
}

