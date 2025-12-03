# WhatsApp AI Agent with Meeting Management System

WhatsApp conversational AI agent powered by OpenAI , integrated with WA Sender API and Redis persistence layer. The system includes automated meeting scheduling, reminder notifications, and comprehensive conversation management.

## Core Features

### Conversation Management
- Multi-modal message processing (text, images, voice messages)
- Message normalization to unified data structure
- Message batching with configurable time windows
- Persistent conversation history (Redis-backed)
- Context retention (configurable message limit)
- GPT-4 powered intelligent responses
- Human-like response timing with randomized delays

### Meeting Management System
- Automated meeting scheduling via n8n integration
- Meeting data persistence in Redis with TTL
- Automatic meeting confirmation messages
- Meeting information injection into conversation context
- RESTful API for meeting CRUD operations

### Automated Reminder System
- Day-of-meeting reminders (configurable time)
- Pre-meeting reminders (configurable minutes before)
- Israel timezone support with DST handling
- Exponential backoff retry logic
- Duplicate prevention with flag-based tracking
- Scheduled execution with 60-second intervals

### Smart Opt-Out System
- AI-powered opt-out request detection
- Supports Hebrew, English, and mixed languages
- Automatic re-engagement when customer sends message after opting out
- Redis-based subscription status management
- Automatic reminder blocking for opted-out customers
- Graceful fallback to keyword matching if AI unavailable

### Reliability Features
- Automatic retry mechanism for failed API calls (429 handling)
- Rate limiting with exponential backoff
- Connection pooling for Redis
- Graceful error handling and logging
- Health check endpoint for monitoring

## Project Structure

```
src/
├── server.ts                    # Express server entry point
├── config.ts                    # Centralized configuration loader
│
├── prompts/
│   ├── system_prompt.txt        # AI agent system prompt (editable)
│   └── vision_prompt.txt        # Vision analysis prompt template
│
├── optout/
│   ├── types.ts                 # Opt-out system type definitions
│   ├── optOutDetector.ts        # AI-powered opt-out detection
│   └── optOutManager.ts         # Redis-based opt-out management
│
├── types/
│   ├── normalized.ts            # Normalized message types
│   ├── whatsapp.ts             # WA Sender API types
│   └── openai.ts               # OpenAI API types
│
├── utils/
│   ├── logger.ts               # Structured JSON logging
│   ├── time.ts                 # Time utilities and human delays
│   ├── timeout.ts              # Timeout helpers
│   └── webhookAuth.ts          # Webhook authentication
│
├── wa/
│   ├── webhookHandler.ts       # Webhook request handler
│   ├── normalize.ts            # Message normalization layer
│   ├── decryptMedia.ts         # Media decryption and processing
│   └── sendMessage.ts          # Message sending with retry logic
│
├── buffer/
│   └── bufferManager.ts        # Message batching with timers
│
├── conversation/
│   ├── historyManager.ts       # Redis-backed history management
│   └── buildPrompt.ts          # Prompt construction for OpenAI
│
├── openai/
│   ├── client.ts               # OpenAI API client
│   ├── transcribe.ts           # Audio transcription (Whisper)
│   └── vision.ts               # Image analysis (GPT-4 Vision)
│
├── db/
│   └── redis.ts                # Redis connection management
│
└── calendar/
    ├── routes.ts               # Meeting API endpoints
    ├── types.ts                # Meeting data structures
    ├── validation.ts           # Input validation and normalization
    ├── meetingStorage.ts       # Redis meeting persistence
    ├── sendConfirmation.ts     # Meeting confirmation sender
    ├── dateFormatter.ts        # Hebrew date/time formatting
    ├── messageBuilder.ts       # Message template builder
    └── reminders/
        ├── scheduler.ts        # Reminder scheduler (60s intervals)
        ├── messages.ts         # Reminder message templates
        ├── timeUtils.ts        # Timezone and date calculations
        └── testReminders.ts    # Testing utilities
```

## Architecture Overview

### Message Flow Pipeline

```
WhatsApp Message
    ↓
WA Sender Webhook (POST /webhook)
    ↓
Webhook Authentication & Validation
    ↓
Message Normalization (normalize.ts)
    ↓
Media Processing (if applicable)
    ├─ Images: GPT-4 Vision Analysis
    ├─ Audio: Whisper Transcription
    └─ Documents: Metadata extraction
    ↓
Buffer Manager (8-second batching window)
    ↓
History Manager (Redis retrieval)
    ↓
Prompt Builder (system + history + batch)
    ↓
OpenAI API (GPT-4)
    ↓
Response Processing
    ↓
History Update (Redis storage)
    ↓
Human Delay (1.5-3 seconds)
    ↓
WhatsApp Message Delivery (with retry)
```

### Meeting Management Flow

```
Google Calendar Appointment
    ↓
n8n Webhook Trigger
    ↓
POST /calendar/meeting
    ↓
Validation & Normalization
    ↓
Redis Storage (meeting:{phone})
    ├─ TTL: 3 days
    └─ Flags: {sentDayReminder, sentBeforeReminder}
    ↓
Parallel Operations:
    ├─ Add to Chat History (system message)
    └─ Send Confirmation Message (WhatsApp)
```

### Reminder Scheduler Flow

```
Scheduler Loop (60-second interval)
    ↓
Fetch All Meetings (KEYS meeting:*)
    ↓
For Each Meeting:
    ├─ Calculate time difference (Israel timezone)
    ├─ Check Day-of Reminder Window (09:00 ±3 min)
    │   ├─ If match & flag=false: Send reminder
    │   └─ Update flag: sentDayReminder=true
    └─ Check Before-Meeting Window (45 ±3 min)
        ├─ If match & flag=false: Send reminder
        └─ Update flag: sentBeforeReminder=true
```

---

## Installation

### Prerequisites
- Node.js 18+ (22.x recommended)
- Redis instance (local or cloud)
- WA Sender API credentials
- OpenAI API key

### Setup Steps

1. Clone repository and install dependencies:
```bash
npm install
```

2. Install additional timezone support:
```bash
npm install date-fns date-fns-tz
```

3. Configure environment variables in `.env`:

```bash
# Server
PORT=3000

# WA Sender API
WA_SENDER_BASE_URL=https://wasenderapi.com/api
WA_SENDER_API_KEY=your_api_key
WA_SENDER_WEBHOOK_SECRET=your_webhook_secret

# OpenAI
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_MAX_TOKENS=1000
OPENAI_TEMPERATURE=0.7

# Redis
REDIS_ENABLED=true
REDIS_HOST=your-redis-host.com
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_TTL_DAYS=7

# Meeting Reminders
REMINDER_DAY_OF_MEETING_TIME=09:00
REMINDER_MINUTES_BEFORE=45
REMINDER_WINDOW_MINUTES=3

# Conversation Settings
MAX_HISTORY_MESSAGES=40
BATCH_WINDOW_MS=8000
MIN_RESPONSE_DELAY_MS=1500
MAX_RESPONSE_DELAY_MS=3000
```

## Running the Application

### Development Mode
```bash
npm run dev
```
Hot-reload enabled with ts-node-dev for rapid development.

### Production Build
```bash
npm run build
npm start
```
Compiles TypeScript to JavaScript and copies static assets.

---

## API Endpoints

### Health & Monitoring
- **GET /health**
  - Returns server status and Redis connection state
  - Response: `{status, timestamp, redis, version}`

### WhatsApp Webhook
- **POST /webhook**
- **POST /webhook/whatsapp**
  - Receives incoming messages from WA Sender
  - Validates webhook signature
  - Triggers message processing pipeline

### Meeting Management API
- **POST /calendar/meeting**
  - Receives meeting data from n8n automation
  - Request body: `[{customer_name, customer_phone, meeting_date, meeting_time}]`
  - Validates input, saves to Redis, sends confirmation
  
- **GET /calendar/meeting/:phone**
  - Retrieves meeting details for a phone number
  - Returns meeting object or 404 if not found
  
- **DELETE /calendar/meeting/:phone**
  - Removes meeting from Redis
  - Returns success status

### Testing Endpoints
- **POST /calendar/test/day-reminder/:phone**
  - Sends day-of-meeting reminder immediately (testing only)
  
- **POST /calendar/test/before-reminder/:phone**
  - Sends pre-meeting reminder immediately (testing only)
  
- **GET /calendar/test/list-meetings**
  - Lists all active meetings in Redis (debugging)

---

## Core Components

### 1. Buffer Manager
**Purpose:** Message batching to reduce API calls and improve context coherence.

**Mechanism:**
- Each phone number maintains an independent message buffer
- First message triggers an 8-second timer (configurable via `BATCH_WINDOW_MS`)
- Subsequent messages within the window are aggregated
- Timer expiration triggers batch processing

**Implementation Details:**
- In-memory Map structure: `Map<phone, {messages, timer}>`
- Automatic cleanup after processing
- Thread-safe for concurrent users

### 2. History Manager
**Purpose:** Conversation context persistence and retrieval.

**Redis Storage:**
- Key format: `chat:{phone}` (e.g., `chat:972523006544`)
- Value: JSON array of ChatMessage objects
- TTL: Configurable days (default: 7 days)
- Max size: Configurable message count (default: 40 messages)

**Fallback Mechanism:**
- Primary: Redis-backed persistent storage
- Fallback: In-memory Map (non-persistent)
- Automatic fallback on Redis connection failure

**Customer Metadata:**
- Key format: `customer:{phone}`
- Data: `{name, gender, savedAt}`
- TTL: 365 days (long-term retention)

### 3. Message Normalization
**Purpose:** Unified data structure from various WhatsApp message types.

**Supported Types:**
- Text messages
- Image messages (with optional caption)
- Video messages (with optional caption)
- Audio messages (voice notes)
- Document messages

**Media Processing:**
- Automatic decryption of encrypted media URLs
- Image analysis via GPT-4 Vision API
- Audio transcription via Whisper API
- Timeout protection (30 seconds per operation)

### 4. Meeting System
**Purpose:** Automated meeting scheduling and reminder delivery.

**Data Model:**
```typescript
interface Meeting {
  phone: string;           // Normalized to 05XXXXXXXX
  name: string;           // Customer full name
  date: string;           // YYYY-MM-DD format
  time: string;           // HH:MM format (24-hour)
  createdAt: number;      // Unix timestamp (ms)
  flags?: {
    sentDayReminder: boolean;
    sentBeforeReminder: boolean;
  }
}
```

**Redis Storage:**
- Key format: `meeting:{phone}`
- TTL: 3 days (259200 seconds)
- Automatic expiration cleanup

**Workflow Integration:**
1. Google Calendar appointment created
2. n8n webhook triggered
3. POST request to `/calendar/meeting`
4. Validation and normalization
5. Redis persistence
6. Parallel operations:
   - Confirmation message sent to customer
   - System message added to chat history

### 5. Reminder Scheduler
**Purpose:** Time-based reminder delivery system.

**Execution Model:**
- Interval-based polling: 60-second cycles
- Scans all Redis keys matching `meeting:*`
- Evaluates reminder conditions per meeting
- Updates flags to prevent duplicates

**Reminder Types:**

1. **Day-of-Meeting Reminder**
   - Trigger: Configured time on meeting date (default: 09:00)
   - Window: ±3 minutes (configurable)
   - Condition: `isSameDay && timeMatch && !sentDayReminder`

2. **Pre-Meeting Reminder**
   - Trigger: Configured minutes before meeting (default: 45)
   - Window: ±3 minutes (configurable)
   - Condition: `diffMinutes in [42,45] && !sentBeforeReminder`

**Timezone Handling:**
- All times in Israel timezone (Asia/Jerusalem)
- Automatic DST adjustment via date-fns-tz
- UTC conversion for server compatibility

### 6. Prompt Construction
**Purpose:** Context-aware prompt generation for OpenAI.

**Prompt Structure:**
```
1. System Prompt (from system_prompt.txt)
2. Customer Metadata (if available): "שם הלקוח: {name}, מגדר: {gender}"
3. Meeting Info (if exists): "{name} קבע/ה פגישת ייעוץ {date} {time}"
4. Conversation History (last N messages)
5. Current Batch Messages (1-N new messages)
```

**Context Injection:**
- Dynamic customer information
- Meeting awareness for scheduled appointments
- Historical context for coherent conversations

---

## Logging System

All logs use structured JSON format for machine parsing:

```json
{
  "timestamp": "2025-12-03T12:00:00.000Z",
  "level": "INFO | DEBUG | WARN | ERROR",
  "message": "Human-readable message",
  "context": {
    "key": "value"
  }
}
```

**Log Levels:**
- **INFO**: Normal operation events (messages received, sent, etc.)
- **DEBUG**: Detailed debugging information (normalization, processing)
- **WARN**: Non-critical issues (Redis fallback, retry attempts)
- **ERROR**: Critical failures (API errors, connection failures)

---

## Detailed Process Flows

### Conversation Message Processing

**Step 1: Webhook Reception**
- Express route: `/webhook` or `/webhook/whatsapp`
- Request validation: Signature verification (HMAC-SHA256)
- Payload parsing: Extract message data from WA Sender format

**Step 2: Message Normalization**
- Type detection: text, image, video, audio, document
- Field extraction: phone, name, timestamp, content
- Media handling: URL extraction and metadata

**Step 3: Media Processing (if applicable)**
- **Images:**
  - Media decryption (if encrypted)
  - Vision API call (GPT-4 Vision)
  - Analysis text extraction
  - Caption merging with analysis
  
- **Audio (Voice Messages):**
  - Media decryption
  - Download to buffer
  - Whisper API transcription
  - Transcribed text as message content

**Step 4: Buffer Management**
- Phone-based buffer lookup or creation
- Message insertion to buffer array
- Timer handling:
  - If no timer: Start new timer (BATCH_WINDOW_MS)
  - If timer exists: Add to existing batch
- Timer expiration: Flush buffer to conversation handler

**Step 5: History Retrieval**
- Redis lookup: `GET chat:{phone}`
- Parse JSON array of previous messages
- Fallback to in-memory if Redis unavailable

**Step 6: Prompt Construction**
- Load system prompt from file
- Inject customer metadata (if available)
- Inject meeting information (if exists)
- Append conversation history
- Add current message batch
- Format for OpenAI API

**Step 7: OpenAI API Call**
- Model: Configurable (default: gpt-4-turbo-preview)
- Max tokens: Configurable (default: 1000)
- Temperature: Configurable (default: 0.7)
- Stream: Disabled (full response)

**Step 8: History Update**
- Add batch messages as user messages
- Add AI response as assistant message
- Trim history to max size (FIFO eviction)
- Redis persistence: `SETEX chat:{phone} {ttl} {json}`

**Step 9: Response Delivery**
- Human-like delay: Random 1.5-3 seconds
- Phone format conversion: 05XXX → 972XXX
- WhatsApp API call with retry logic
- Success/failure logging

### Meeting Scheduling Process

**Step 1: External Trigger**
- Google Calendar appointment created by customer
- n8n workflow activation
- HTTP POST to `/calendar/meeting`

**Step 2: Request Validation**
- Array/object normalization
- Required field validation:
  - customer_phone: Israeli or international format
  - meeting_date: YYYY-MM-DD format
  - meeting_time: HH:MM format (24-hour)
  - customer_name: Optional, defaults to "לקוח"
- Date validation: Must be in the future

**Step 3: Data Normalization**
- Phone normalization: Any format → 05XXXXXXXX
- Name trimming and whitespace cleanup
- Timestamp generation

**Step 4: Redis Persistence**
- Key: `meeting:{normalized_phone}`
- Value: JSON-serialized Meeting object
- TTL: 3 days (automatic cleanup)
- Flags initialization: `{sentDayReminder: false, sentBeforeReminder: false}`

**Step 5: Context Integration**
- Chat history retrieval
- System message creation (Hebrew formatted)
- History append and persistence
- AI agent gains meeting awareness

**Step 6: Confirmation Delivery**
- Message building with Hebrew date formatting
- Phone conversion to international format
- WhatsApp API call
- Non-blocking execution (async void)

### Reminder Delivery Process

**Scheduler Initialization:**
- Triggered on server startup (if Redis enabled)
- Interval setup: 60000ms (1 minute)
- Configuration logging

**Per-Cycle Execution:**

1. **Meeting Discovery**
   - Redis scan: `KEYS meeting:*`
   - Batch retrieval of meeting data
   - Parse JSON objects

2. **Time Calculation**
   - Current time in Israel timezone: `getNowInIsrael()`
   - Meeting time parsing: `parseTimeToDate(time, date)`
   - Difference calculation: `diffInMinutes(meeting, now)`

3. **Day-of Reminder Logic**
   ```
   if (
     today == meeting.date &&
     abs(now - targetTime) <= windowMinutes &&
     !flags.sentDayReminder
   ) {
     sendReminder()
     flags.sentDayReminder = true
   }
   ```

4. **Pre-Meeting Reminder Logic**
   ```
   if (
     diffMinutes <= reminderMinutesBefore &&
     diffMinutes >= (reminderMinutesBefore - windowMinutes) &&
     !flags.sentBeforeReminder
   ) {
     sendReminder()
     flags.sentBeforeReminder = true
   }
   ```

5. **Flag Persistence**
   - Updated meeting object
   - Redis write: `SET meeting:{phone} {json}`
   - Maintains existing TTL

### Opt-Out Management Process

**Opt-Out Detection (AI-Powered):**

1. **Message Reception**
   - Incoming text message received via webhook
   - Phone number extracted and normalized

2. **Current Status Check**
   ```typescript
   const isOptedOut = await redis.get(`customer:{phone}.optOut`)
   if (isOptedOut) {
     // Customer previously opted out → Re-engage them
     await redis.del(`customer:{phone}.optOut`)
     logger.info("Customer re-engaged")
     // Continue processing normally
   }
   ```

3. **AI Detection**
   - Message sent to OpenAI GPT-4o-mini
   - Specialized prompt for opt-out intent detection
   - Response format:
   ```json
   {
     "isOptOut": true/false,
     "confidence": "high"/"medium"/"low",
     "detectedPhrase": "הסר אותי"
   }
   ```

4. **Fallback Detection** (if AI fails)
   - Keyword matching: "הסר", "stop", "unsubscribe", "תפסיק", etc.
   - Case-insensitive matching
   - Confidence assignment based on keyword strength

5. **Opt-Out Execution** (if detected)
   ```typescript
   if (detection.isOptOut && detection.confidence !== "low") {
     const status = {
       phone,
       unsubscribed: true,
       timestamp: Date.now(),
       reason: detection.detectedPhrase
     }
     await redis.setex(`customer:{phone}.optOut`, ttl, JSON.stringify(status))
     await sendTextMessage(phone, "הבנתי, הסרתי אותך מרשימת התפוצה. אם תרצה לחזור ולשוחח, פשוט שלח לי הודעה בכל עת! 👋")
     return // Stop processing
   }
   ```

6. **Re-Engagement Logic**
   - Any message from opted-out customer triggers re-engagement
   - Opt-out status cleared automatically
   - Message processed normally
   - No explicit "subscribe" command needed

7. **Reminder Protection**
   - Scheduler checks opt-out status before sending reminders
   - Opted-out customers skipped with log entry
   - Meeting data preserved but reminders blocked

**Supported Opt-Out Phrases:**
- Hebrew: "הסר אותי", "הסרה", "תפסיק", "הפסק", "עזוב אותי", "אל תכתוב לי"
- English: "stop", "unsubscribe", "remove"
- Mixed language variations

---

## Redis Data Schema

### Conversation History
**Key:** `chat:{phone}` (e.g., `chat:972523006544`)  
**Type:** String (JSON-serialized array)  
**TTL:** Configurable days (default: 7 days)  
**Structure:**
```json
[
  {
    "role": "user|assistant|system",
    "content": "Message text or transcription",
    "timestamp": 1733227800000
  }
]
```

### Customer Metadata
**Key:** `customer:{phone}`  
**Type:** String (JSON-serialized object)  
**TTL:** 365 days  
**Structure:**
```json
{
  "name": "Customer name",
  "gender": "male|female",
  "savedAt": 1733227800000
}
```

### Opt-Out Status
**Key:** `customer:{phone}.optOut`  
**Type:** String (JSON-serialized object)  
**TTL:** Same as conversation history (default: 7 days)  
**Structure:**
```json
{
  "phone": "972523006544",
  "unsubscribed": true,
  "timestamp": 1733227800000,
  "reason": "הסר אותי"
}
```
**Notes:**
- Created when customer requests opt-out
- Automatically deleted upon re-engagement (customer sends message)
- Blocks reminders but not conversation if customer initiates

### Meeting Data
**Key:** `meeting:{phone}`  
**Type:** String (JSON-serialized object)  
**TTL:** 3 days  
**Structure:**
```json
{
  "phone": "0523006544",
  "name": "Full name",
  "date": "2025-12-10",
  "time": "15:50",
  "createdAt": 1733227800000,
  "flags": {
    "sentDayReminder": false,
    "sentBeforeReminder": false
  }
}
```

---

## Error Handling & Resilience

### Retry Logic (429 Rate Limiting)
**Implementation:** `sendMessage.ts`  
**Strategy:** Exponential backoff with max retries

**Algorithm:**
```
Attempt 1: Immediate send
  └─ 429 Error → Wait 5 seconds
Attempt 2: Retry
  └─ 429 Error → Wait 10 seconds
Attempt 3: Retry
  └─ 429 Error → Wait 15 seconds
Attempt 4: Fail gracefully
```

**Benefits:**
- Automatic recovery from temporary rate limits
- No manual intervention required
- Preserves message delivery reliability

### Redis Fallback Strategy
**Primary:** Redis-backed persistent storage  
**Fallback:** In-memory Map structure  
**Trigger:** Redis connection failure or unavailability

**Implications:**
- In-memory mode: Context lost on server restart
- Redis mode: Persistent context across restarts
- Automatic detection and logging

### Timeout Protection
**Media Processing:** 30-second timeout per operation  
**OpenAI API:** Request-level timeout configuration  
**Graceful Degradation:** Fallback to text-only on media failure

---

## Timezone Management

**Challenge:** Cloud servers run in UTC, customers in Israel (UTC+2/UTC+3)

**Solution:**
- Library: `date-fns-tz` for timezone conversion
- Timezone: `Asia/Jerusalem` with automatic DST
- Functions:
  - `parseTimeToDate(time, date)`: Converts Israel time to Date object
  - `getNowInIsrael()`: Current time in Israel timezone
  - `diffInMinutes(a, b)`: Time difference calculation

**DST Handling:**
- Winter: UTC+2 (November - March)
- Summer: UTC+3 (March - November)
- Automatic transition detection

---

## Configuration

All configuration is centralized in `config.ts`, loaded from environment variables.

**Categories:**
- **Server:** Port, base URLs
- **WA Sender:** API credentials, webhook secret
- **OpenAI:** Model, tokens, temperature
- **Redis:** Connection, TTL, enablement
- **Conversation:** History size, batch window, response delays
- **Reminders:** Times, windows, scheduling

**Validation:** Required variables are checked on startup; missing variables cause process exit.

---

## Development & Testing

### Local Development
```bash
npm run dev
```
Starts server with hot-reload for rapid iteration.

### Building for Production
```bash
npm run build
```
Compiles TypeScript and copies static assets to `dist/`.

### Testing Reminders
```bash
# Send immediate test reminder
curl -X POST http://localhost:3000/calendar/test/day-reminder/0523006544

# List all meetings
curl http://localhost:3000/calendar/test/list-meetings
```

### Monitoring Logs
Watch for key log messages:
- `Redis connected` - Database connection established
- `Meeting Reminder Scheduler Started` - Scheduler initialized
- `Sending meeting confirmation` - Confirmation message queued
- `Before-meeting reminder sent` - Reminder delivered

---

## Deployment (Render)

### Build Command
```bash
npm install && npm run build
```

### Start Command
```bash
npm start
```

### Environment Variables
Set all variables from Configuration section in Render dashboard.

### Post-Deployment Verification
1. Check `/health` endpoint for Redis connection
2. Send test meeting to verify calendar integration
3. Monitor logs for scheduler initialization
4. Test reminder delivery with immediate test endpoints

---

## Performance Characteristics

### Concurrency Model
- Node.js event loop: Single-threaded, non-blocking I/O
- Per-customer isolation: Independent buffers and timers
- Redis connection pooling: Managed by ioredis library

### Scalability
- **10 concurrent customers:** No issues
- **100 concurrent customers:** Recommended Render Starter plan
- **500+ concurrent customers:** Consider Render Standard plan

### Resource Usage
- **Memory:** Minimal in-memory state (buffers only)
- **Redis:** ~1KB per conversation, ~500 bytes per meeting
- **API Rate Limits:**
  - OpenAI GPT-4: 10,000 requests/min, 2M tokens/min
  - WA Sender: Plan-dependent (typically 80-1000 msg/sec)

---

## Security Considerations

### Webhook Authentication
- HMAC-SHA256 signature verification
- Secret-based request validation
- Configurable bypass for development (`SKIP_WEBHOOK_VERIFICATION`)

### Data Privacy
- Customer data encrypted at rest (Redis)
- Automatic TTL-based data expiration
- No long-term PII storage beyond configured retention

### API Security
- Bearer token authentication for external APIs
- Environment-based credential management
- No hardcoded secrets in codebase

---

## Troubleshooting

### Issue: Redis Connection Error
**Symptom:** `getaddrinfo ENOTFOUND`  
**Cause:** REDIS_HOST contains port number  
**Solution:** Remove port from REDIS_HOST, use separate REDIS_PORT variable

### Issue: 429 Rate Limit
**Symptom:** `Request failed with status code 429`  
**Cause:** Too many API requests  
**Solution:** Automatic retry with exponential backoff (built-in)

### Issue: Reminder Not Sent
**Symptom:** Meeting exists but no reminder received  
**Causes:**
- Meeting created after reminder window passed
- Scheduler not running (Redis disabled)
- Flags already set to true (already sent)  
**Solution:** Check meeting `createdAt` vs reminder time windows

### Issue: AI Doesn't Remember Meeting
**Symptom:** Agent unaware of scheduled meetings  
**Solution:** Meeting info automatically added to chat history (system message)

---

## Dependencies

### Production
- `express`: Web server framework
- `axios`: HTTP client for external APIs
- `ioredis`: Redis client with connection pooling
- `openai`: Official OpenAI SDK
- `dotenv`: Environment variable loader
- `date-fns`: Date manipulation utilities
- `date-fns-tz`: Timezone conversion and DST handling

### Development
- `typescript`: Type safety and compilation
- `ts-node-dev`: Development server with hot-reload
- `@types/*`: TypeScript type definitions
- `eslint`: Code linting
- `prettier`: Code formatting

---

## License

ISC

