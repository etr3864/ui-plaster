/**
 * Message Builder
 * Builds confirmation messages for meetings
 */

import { Meeting } from "./types";
import { formatMeetingDateTime, getFirstName } from "./dateFormatter";

/**
 * Build meeting confirmation message
 * 
 * Example output:
 * "איתן, קיבלתי את הפגישה.
 *  נשמור על זמינות ביום רביעי, 3.12.2025 בשעה 15:50 - היועץ שלנו יתקשר אליך.
 *  מחכים לשיחה."
 */
export function buildMeetingConfirmationMessage(meeting: Meeting): string {
  const firstName = getFirstName(meeting.name);
  const dateTime = formatMeetingDateTime(meeting.date, meeting.time);

  const message = `${firstName}, קיבלתי את הפגישה ואני שמחה שהחלטת לקחת את הצעד ולעשות מהכסף שלך עוד כסף.
נא לשמור על זמינות ב ${dateTime}. היועץ שלנו יתקשר אליך.
מקווה שאתה מתרגש כמוני`;

  return message;
}

