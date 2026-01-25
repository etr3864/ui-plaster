/**
 * Calendar Routes
 * API endpoints for meeting management
 */

import { Router, Request, Response } from "express";
import { IncomingMeeting, Meeting, MeetingResponse } from "./types";
import { saveMeeting, getMeeting, deleteMeeting } from "./meetingStorage";
import { validateMeeting, normalizePhone } from "./validation";
import { sendMeetingConfirmation } from "./sendConfirmation";
import { 
  sendTestDayReminder, 
  sendTestBeforeReminder, 
  listAllMeetings 
} from "./reminders/testReminders";
import { formatMeetingDateTime, getFirstName } from "./dateFormatter";
import { logger } from "../utils/logger";
import { getRedis } from "../db/redis";

const router = Router();

/**
 * Convert phone to international format (972...)
 * This matches the format used by WhatsApp webhook
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
 * Add meeting info to chat history
 * This allows the AI to know about scheduled meetings
 */
async function addMeetingToHistory(meeting: Meeting): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;

    // Use international format (972...) to match webhook history format
    const internationalPhone = toInternationalFormat(meeting.phone);
    const chatKey = `chat:${internationalPhone}`;
    const historyData = await redis.get(chatKey);
    
    if (!historyData) {
      // No chat history yet - skip
      return;
    }

    const history = JSON.parse(historyData);
    
    // Format the meeting info in Hebrew
    const firstName = getFirstName(meeting.name);
    const dateTime = formatMeetingDateTime(meeting.date, meeting.time);
    const meetingInfo = `${firstName} קבע/ה פגישת ייעוץ ${dateTime}`;

    // Add as system message
    history.push({
      role: "system",
      content: meetingInfo,
      timestamp: Date.now(),
    });

    // Save back to Redis
    const ttlSeconds = await redis.ttl(chatKey);
    if (ttlSeconds > 0) {
      await redis.setex(chatKey, ttlSeconds, JSON.stringify(history));
      logger.info(" Meeting added to chat history", {
        phone: internationalPhone,
        info: meetingInfo,
      });
    }
  } catch (error) {
    logger.warn("  Failed to add meeting to history", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * POST /calendar/meeting
 * Receive meeting from n8n automation
 * 
 * Expected body (array of meetings):
 * [
 *   {
 *     "customer_name": "איתן טורגמן",
 *     "customer_phone": "0523006544",
 *     "meeting_date": "2025-12-03",
 *     "meeting_time": "15:50"
 *   }
 * ]
 */
router.post("/meeting", async (req: Request, res: Response) => {
  try {
    // Handle both array and single object
    const meetings = Array.isArray(req.body) ? req.body : [req.body];

    if (meetings.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No meeting data provided",
      } as MeetingResponse);
    }

    // Process first meeting (in case array has multiple)
    const incomingMeeting = meetings[0] as Partial<IncomingMeeting>;

    // Validate meeting data
    const validation = validateMeeting(incomingMeeting);
    if (!validation.valid) {
      logger.warn("  Invalid meeting data", { error: validation.error });
      return res.status(400).json({
        status: "error",
        message: validation.error,
      } as MeetingResponse);
    }

    // Normalize and prepare meeting object
    const phone = normalizePhone(incomingMeeting.customer_phone!);
    const name = incomingMeeting.customer_name?.trim() || "לקוח";

    const meeting: Meeting = {
      phone,
      name,
      date: incomingMeeting.meeting_date!,
      time: incomingMeeting.meeting_time!,
      createdAt: Date.now(),
    };

    // Save to Redis
    const saved = await saveMeeting(meeting);

    if (!saved) {
      return res.status(500).json({
        status: "error",
        message: "Failed to save meeting",
      } as MeetingResponse);
    }

    logger.info(" Meeting received and saved", {
      phone: meeting.phone,
      name: meeting.name,
      date: meeting.date,
      time: meeting.time,
    });

    // Add meeting info to chat history (async - don't wait)
    void addMeetingToHistory(meeting);

    // Send confirmation message to customer (async - don't wait)
    void sendMeetingConfirmation(meeting);

    return res.status(200).json({
      status: "ok",
      message: "Meeting saved successfully",
      data: meeting,
    } as MeetingResponse);

  } catch (error) {
    logger.error(" Error processing meeting", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    } as MeetingResponse);
  }
});

/**
 * GET /calendar/meeting/:phone
 * Get meeting for specific phone number
 */
router.get("/meeting/:phone", async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const meeting = await getMeeting(phone);

    if (!meeting) {
      return res.status(404).json({
        status: "error",
        message: "No meeting found for this phone number",
      } as MeetingResponse);
    }

    return res.status(200).json({
      status: "ok",
      message: "Meeting found",
      data: meeting,
    } as MeetingResponse);

  } catch (error) {
    logger.error(" Error retrieving meeting", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    } as MeetingResponse);
  }
});

/**
 * DELETE /calendar/meeting/:phone
 * Delete meeting for specific phone number
 */
router.delete("/meeting/:phone", async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const deleted = await deleteMeeting(phone);

    if (!deleted) {
      return res.status(500).json({
        status: "error",
        message: "Failed to delete meeting",
      } as MeetingResponse);
    }

    return res.status(200).json({
      status: "ok",
      message: "Meeting deleted successfully",
    } as MeetingResponse);

  } catch (error) {
    logger.error(" Error deleting meeting", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    } as MeetingResponse);
  }
});

// ===============================================
// 🧪 TEST ENDPOINTS (for testing reminders)
// ===============================================

/**
 * POST /calendar/test/day-reminder/:phone
 * Send test day-of-meeting reminder immediately
 */
router.post("/test/day-reminder/:phone", async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const sent = await sendTestDayReminder(phone);

    if (sent) {
      return res.status(200).json({
        status: "ok",
        message: "Test day reminder sent successfully",
      });
    } else {
      return res.status(500).json({
        status: "error",
        message: "Failed to send test reminder",
      });
    }
  } catch (error) {
    logger.error(" Error sending test day reminder", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * POST /calendar/test/before-reminder/:phone
 * Send test before-meeting reminder immediately
 */
router.post("/test/before-reminder/:phone", async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const minutesBefore = req.body.minutesBefore || 45;
    const sent = await sendTestBeforeReminder(phone, minutesBefore);

    if (sent) {
      return res.status(200).json({
        status: "ok",
        message: "Test before-meeting reminder sent successfully",
      });
    } else {
      return res.status(500).json({
        status: "error",
        message: "Failed to send test reminder",
      });
    }
  } catch (error) {
    logger.error(" Error sending test before reminder", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * GET /calendar/test/list-meetings
 * List all meetings in Redis (for debugging)
 */
router.get("/test/list-meetings", async (_req: Request, res: Response) => {
  try {
    const meetings = await listAllMeetings();

    return res.status(200).json({
      status: "ok",
      count: meetings.length,
      meetings,
    });
  } catch (error) {
    logger.error(" Error listing meetings", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

export default router;

