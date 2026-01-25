/**
 * Reminder Messages Builder
 * Builds reminder messages for meetings
 */

import { Meeting } from "../types";
import { getFirstName } from "../dateFormatter";

/**
 * Format time to Hebrew format (remove leading zero if needed)
 * Example: "15:50" -> "15:50", "09:30" -> "9:30"
 */
function formatTime(time: string): string {
  const [hour, minute] = time.split(":");
  return `${parseInt(hour)}:${minute}`;
}

/**
 * Build reminder message for day of meeting
 * Sent at configured time on the day of the meeting
 * 
 * Example: "איתן, תזכורת לשיחת הייעוץ שקבעת היום בשעה 15:50. נשמח לדבר איתך."
 */
export function buildDayReminderMessage(meeting: Meeting): string {
  const firstName = getFirstName(meeting.name);
  const time = formatTime(meeting.time);
  return `${firstName}, תזכורת לשיחת הייעוץ שקבעת היום בשעה ${time}. מחכים לדבר איתך.`;
}

/**
 * Build reminder message for X minutes before meeting
 * Sent at configured minutes before the meeting time
 * 
 * Example: "איתן, בעוד 45 דקות (בשעה 15:50) נתקשר אליך לשיחת הייעוץ. אנא שמור על זמינות."
 */
export function buildBeforeReminderMessage(meeting: Meeting, minutesBefore: number): string {
  const firstName = getFirstName(meeting.name);
  const time = formatTime(meeting.time);
  return `${firstName}, בעוד ${minutesBefore} דקות (בשעה ${time}) נתקשר אליך לשיחת הייעוץ. אנא שמור על זמינות.`;
}

