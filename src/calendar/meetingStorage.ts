/**
 * Meeting Storage
 * Handles saving and retrieving meeting data from Redis
 */

import { getRedis } from "../db/redis";
import { logger } from "../utils/logger";
import { Meeting } from "./types";

const MEETING_TTL_DAYS = 3; // Meetings are kept for 3 days

/**
 * Get Redis key for meeting
 */
function getMeetingKey(phone: string): string {
  return `meeting:${phone}`;
}

/**
 * Save meeting to Redis
 */
export async function saveMeeting(meeting: Meeting): Promise<boolean> {
  const redis = getRedis();

  if (!redis) {
    logger.warn("  Redis not available - cannot save meeting");
    return false;
  }

  try {
    const key = getMeetingKey(meeting.phone);
    const ttlSeconds = MEETING_TTL_DAYS * 24 * 60 * 60;
    
    // Initialize flags if not present
    const meetingWithFlags: Meeting = {
      ...meeting,
      flags: meeting.flags || {
        sentDayReminder: false,
        sentBeforeReminder: false,
      },
    };
    
    await redis.setex(key, ttlSeconds, JSON.stringify(meetingWithFlags));
    
    logger.info(" Meeting saved", {
      phone: meeting.phone,
      name: meeting.name,
      date: meeting.date,
      time: meeting.time,
    });

    return true;
  } catch (error) {
    logger.error(" Failed to save meeting to Redis", {
      error: error instanceof Error ? error.message : String(error),
      phone: meeting.phone,
    });
    return false;
  }
}

/**
 * Get meeting from Redis
 */
export async function getMeeting(phone: string): Promise<Meeting | null> {
  const redis = getRedis();

  if (!redis) {
    return null;
  }

  try {
    const key = getMeetingKey(phone);
    const data = await redis.get(key);

    if (!data) {
      return null;
    }

    const meeting = JSON.parse(data) as Meeting;
    return meeting;
  } catch (error) {
    logger.warn("  Failed to get meeting from Redis", {
      error: error instanceof Error ? error.message : String(error),
      phone,
    });
    return null;
  }
}

/**
 * Delete meeting from Redis
 */
export async function deleteMeeting(phone: string): Promise<boolean> {
  const redis = getRedis();

  if (!redis) {
    return false;
  }

  try {
    const key = getMeetingKey(phone);
    await redis.del(key);
    
    logger.info("  Meeting deleted", { phone });
    return true;
  } catch (error) {
    logger.error(" Failed to delete meeting from Redis", {
      error: error instanceof Error ? error.message : String(error),
      phone,
    });
    return false;
  }
}

