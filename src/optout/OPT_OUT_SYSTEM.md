# Smart Opt-Out System

## Overview

The Smart Opt-Out System allows customers to unsubscribe from messages by sending opt-out phrases like "הסר אותי", "stop", or "תפסיק לשלוח". The system uses AI to detect opt-out requests with high accuracy and automatically manages subscription status in Redis.

## Key Features

### 1. AI-Powered Detection
- Uses OpenAI GPT-4o-mini to understand intent, not just keywords
- Detects opt-out requests in Hebrew, English, and mixed languages
- Confidence levels: high, medium, low
- Fallback to keyword matching if AI fails

### 2. Smart Re-Engagement
- If a customer sends ANY message after opting out, they are automatically re-engaged
- This assumes the customer changed their mind and wants to continue the conversation
- No need to send "subscribe" or similar commands

### 3. Redis-Based Storage
- Opt-out status stored in Redis with same TTL as conversation history (7 days default)
- Key format: `customer:{phone}.optOut`
- Includes timestamp and reason for opt-out

### 4. Automatic Reminder Blocking
- Meeting reminders are NOT sent to opted-out customers
- Checked before every reminder in the scheduler

## Architecture

```
src/optout/
├── types.ts              # TypeScript interfaces
├── optOutDetector.ts     # AI-powered detection
├── optOutManager.ts      # Redis management
└── (integrated into webhookHandler.ts and scheduler.ts)
```

## Flow Diagram

### Normal Message Flow:
```
Message Received
    ↓
Check if customer is opted out
    ↓
    Yes → Re-engage customer (clear opt-out)
    No → Continue
    ↓
Check if THIS message is opt-out request (AI)
    ↓
    Yes → Set opt-out, send confirmation, STOP
    No → Continue normal processing
```

### Reminder Flow:
```
Meeting Reminder Due
    ↓
Check if customer is opted out
    ↓
    Yes → Skip reminder
    No → Send reminder
```

## AI Detection Prompt

The system uses a specialized prompt to detect opt-out intent:

**Input:** Customer message (text)
**Output:** JSON with `isOptOut`, `confidence`, `detectedPhrase`

**Examples:**
- "הסר אותי" → `{"isOptOut": true, "confidence": "high", "detectedPhrase": "הסר אותי"}`
- "תודה רבה" → `{"isOptOut": false, "confidence": "high", "detectedPhrase": null}`
- "אני עסוק עכשיו" → `{"isOptOut": false, "confidence": "high", "detectedPhrase": null}`

## Redis Data Structure

### Opt-Out Status Key:
```
customer:{phone}.optOut
```

### Value (JSON):
```json
{
  "phone": "972521234567",
  "unsubscribed": true,
  "timestamp": 1732816800000,
  "reason": "הסר אותי"
}
```

### TTL:
Same as conversation history (default: 7 days)

## API Functions

### `optOutDetector.ts`

#### `detectOptOut(message: string): Promise<OptOutDetection>`
- Detects if a message is an opt-out request
- Uses AI first, falls back to keyword matching
- Returns: `{ isOptOut, confidence, detectedPhrase }`

### `optOutManager.ts`

#### `isOptedOut(phone: string): Promise<boolean>`
- Checks if a customer is currently opted out
- Returns: `true` if opted out, `false` otherwise

#### `setOptOut(phone: string, reason?: string): Promise<void>`
- Marks a customer as opted out
- Saves to Redis with TTL
- Logs the action

#### `clearOptOut(phone: string): Promise<void>`
- Removes opt-out status (re-engages customer)
- Deletes Redis key
- Logs the re-engagement

#### `getOptOutStatus(phone: string): Promise<OptOutStatus | null>`
- Gets full opt-out status details
- Returns: `OptOutStatus` object or `null`

## Integration Points

### 1. Webhook Handler (`webhookHandler.ts`)
- **Before processing:** Check if customer is opted out → if yes, re-engage
- **After re-engagement:** Check if message is opt-out request → if yes, opt out and stop
- **Location:** `processMessage()` function

### 2. Reminder Scheduler (`scheduler.ts`)
- **Before sending reminders:** Check if customer is opted out → if yes, skip
- **Location:** `processMeeting()` function

## Configuration

No additional environment variables required. The system uses:
- `REDIS_ENABLED` - Must be `true` for opt-out to work
- `REDIS_TTL_DAYS` - TTL for opt-out status (default: 7)

## Logging

### Opt-Out Request Detected:
```
🚫 Opt-out request detected! { confidence: 'high', phrase: 'הסר אותי', durationMs: 123 }
✅ Customer opted out { phone: '972521234567', reason: 'הסר אותי', expiresIn: '7 days' }
✅ Opt-out confirmation sent { phone: '972521234567' }
```

### Re-Engagement:
```
🔄 Customer re-engaged after opt-out! { phone: '972521234567' }
✅ Customer re-engaged! Opt-out cleared { phone: '972521234567' }
```

### Reminder Blocked:
```
🚫 Skipping reminder - customer opted out { phone: '972521234567', name: 'ישראל ישראלי' }
```

## Fallback Behavior

If Redis is disabled or unavailable:
- `isOptedOut()` returns `false` (no one is blocked)
- `setOptOut()` logs a warning but doesn't block
- `clearOptOut()` does nothing
- System continues to work normally without opt-out protection

This ensures the system is resilient and never blocks customers due to infrastructure issues.

## Testing Checklist

### Manual Tests:

1. **Basic Opt-Out:**
   - Customer sends "הסר אותי"
   - System responds with confirmation
   - Customer is marked as opted out in Redis
   - No further messages processed

2. **Re-Engagement:**
   - Customer opts out
   - Customer sends any message
   - System logs re-engagement
   - Message is processed normally

3. **Reminder Blocking:**
   - Customer opts out
   - Meeting reminder is due
   - Reminder is NOT sent (logged as skipped)

4. **Various Phrases:**
   - "stop" → detected
   - "unsubscribe" → detected
   - "תפסיק לשלוח לי" → detected
   - "עזוב אותי" → detected (medium confidence)
   - "תודה רבה" → NOT detected

5. **Edge Cases:**
   - Voice message after opt-out → re-engagement works
   - Image after opt-out → re-engagement works
   - Opt-out during media processing → works

6. **Fallback:**
   - Disable AI (simulate failure) → keyword matching kicks in
   - Disable Redis → system continues, no blocking

## Security Considerations

- Opt-out status is tied to phone number (verified by WA Sender)
- No user input can manipulate opt-out status of other users
- Confirmation message prevents accidental opt-outs from being silent
- Re-engagement is automatic but logged for transparency

## Performance Impact

- **AI Detection:** ~100-300ms per message (only for text messages)
- **Redis Check:** ~5-10ms per message
- **Fallback Detection:** ~1-2ms (if AI fails)
- **Total Overhead:** Minimal, all operations are async

## Future Enhancements (Not Implemented)

- Allow customers to opt out of specific types of messages (reminders only, not conversations)
- Opt-out from conversations but not reminders
- Admin dashboard to view opted-out customers
- Scheduled re-engagement campaigns ("We miss you!")

## Support

For issues or questions, check:
1. Redis connection status
2. OpenAI API availability
3. Logs for opt-out detection failures
4. Redis keys: `customer:*.optOut`

