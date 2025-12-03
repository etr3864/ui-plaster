# Voice Reply System - תיעוד מלא למפתח

## סקירה כללית

מערכת Voice Reply מאפשרת לסוכן AI לענות בהודעות קול (TTS) באמצעות ElevenLabs API.

המערכת פועלת בשני מצבים:
1. **תשובה קולית חובה** - כאשר הלקוח שולח הודעת קול, הסוכן תמיד עונה בקול.
2. **תשובה קולית חכמה אחת** - לאחר X הודעות טקסט, המערכת מחליטה באופן חכם (AI) אם להוסיף הודעת קול אחת ליצירת חוויה אישית.

---

## ארכיטקטורה

### מבנה תיקיות

```
src/voice/
├── types.ts                 # Type definitions
├── elevenLabs.ts           # ElevenLabs API integration
├── ttsNormalizer.ts        # AI-powered text normalization for Hebrew TTS
├── voiceDecisionMaker.ts   # Intelligent decision logic
└── voiceReplyHandler.ts    # Main orchestration
```

### Pipeline זרימה

```
Incoming Message
    ↓
Buffer Manager
    ↓
History Manager (flushConversation)
    ↓
OpenAI Response (GPT-4)
    ↓
Voice Decision Check
    ├─ No → Send Text (normal flow)
    └─ Yes → Voice Pipeline:
        ↓
    TTS Normalization (AI micro-module)
        ↓
    ElevenLabs TTS API
        ↓
    sendVoiceMessage (WA Sender)
        ↓
    Save Text to Redis History
```

---

## משתני סביבה

הוסף את המשתנים הבאים ל-`.env`:

```bash
# Voice Reply System
VOICE_REPLIES=on                      # on/off - enable/disable feature
MIN_MESSAGES_FOR_RANDOM_VOICE=5       # Minimum messages before random voice
RANDOM_VOICE_AI_CHECK=on              # on/off - use AI for decision
ELEVENLABS_API_KEY=your_api_key       # ElevenLabs API key
ELEVENLABS_VOICE_ID=your_voice_id     # Voice ID from ElevenLabs
```

### איך לקבל ElevenLabs credentials:

1. הרשם ל-[ElevenLabs](https://elevenlabs.io)
2. נווט ל-Profile → API Keys
3. צור API Key חדש
4. בחר קול (Voice) מהספריה או צור קול מותאם אישית
5. העתק את ה-Voice ID מהעמוד של הקול

---

## מרכיבי המערכת

### 1. elevenLabs.ts - אינטגרציה עם ElevenLabs

**תפקיד:** המרת טקסט לאודיו (TTS).

**פונקציות עיקריות:**
- `textToSpeech(text: string): Promise<Buffer>` - ממיר טקסט לאודיו MP3
- `getCharacterQuota()` - בדיקת מכסת תווים (למעקב)

**הגדרות TTS:**
- Model: `eleven_multilingual_v2` (תומך עברית)
- Stability: 0.5
- Similarity Boost: 0.75
- Timeout: 10 שניות

### 2. ttsNormalizer.ts - נורמליזציה חכמה

**תפקיד:** המרת טקסט צ'אט לטקסט מדובר טבעי בעברית.

**למה AI ולא Regex?**
- כתיבת מספרים במילים (15 → "חמש עשרה")
- תיקון קיצורים (כ"כ → "כל כך")
- הסרת אמוג'ים והתאמת סגנון דיבור
- התאמה דינמית לקשר השיחה

**פונקציות:**
- `normalizeForTTS(text: string): Promise<string>` - נורמליזציה מלאה
- `basicNormalization(text: string): string` - fallback ללא AI

**AI Model:** gpt-4o-mini (מהיר וזול)

### 3. voiceDecisionMaker.ts - החלטה חכמה

**תפקיד:** החלטה האם להשתמש בקול או טקסט.

**לוגיקת החלטה:**

```typescript
// Rule 1: Always voice if customer sent voice
if (incomingMessageType === "audio") {
  return { shouldUseVoice: true };
}

// Rule 2: Intelligent random voice (once per conversation)
if (userMessageCount >= minMessages && !alreadySent && aiApproves) {
  return { shouldUseVoice: true };
}

return { shouldUseVoice: false };
```

**פונקציות עיקריות:**
- `shouldUseVoiceReply()` - ההחלטה המרכזית
- `askAIForVoiceDecision()` - בדיקה חכמה באמצעות AI
- `hasAlreadySentRandomVoice()` - בדיקה ב-Redis
- `markRandomVoiceSent()` - סימון ב-Redis

**Redis Tracking:**
- Key: `customer:{phone}.sentRandomVoice`
- Value: `"true"` or null
- TTL: 7 days (כמו conversation history)

### 4. voiceReplyHandler.ts - תיאום מרכזי

**תפקיד:** ניהול כל תהליך Voice Reply.

**Pipeline:**
1. החלטה (shouldUseVoiceReply)
2. נורמליזציה (normalizeForTTS)
3. המרה לאודיו (textToSpeech)
4. שליחה (sendVoiceMessage)

**פונקציות:**
- `handleVoiceReply(context): Promise<boolean>` - תהליך מלא
- `isVoiceReplyPossible()` - בדיקה מהירה לפני תחילת תהליך

### 5. sendVoiceMessage() - שליחת אודיו

**מיקום:** `src/wa/sendMessage.ts`

**תפקיד:** שליחת הודעת קול ל-WhatsApp דרך WA Sender API.

**שיטת שליחה: Data URI (ללא שרת חיצוני)**

המערכת משתמשת ב-Data URI format - אין צורך ב-Cloudinary, S3, או כל שרת חיצוני.

**Pipeline:**
```
ElevenLabs Buffer (MP3)
    ↓
Convert to Base64
    ↓
Wrap in Data URI: "data:audio/mpeg;base64,XXX"
    ↓
Send to WA Sender
```

**פורמט הבקשה:**
```json
{
  "phone": "972523006544",
  "type": "audio",
  "audio": {
    "data": "data:audio/mpeg;base64,<BASE64_AUDIO>"
  }
}
```

**פרטים טכניים:**
- Endpoint: `/sendMessage` (לא `/send-voice`)
- Format: Data URI עם base64
- MIME Type: `audio/mpeg` (בתוך Data URI)
- Timeout: 30 שניות (מהיר - אין העלאה לשרת)
- Retry Logic: עד 3 ניסיונות ב-429 errors
- גודל מקסימלי: ~2MB (ElevenLabs בדרך כלל <100KB)

**שגיאות נפוצות ו-Logging:**
- 413: Payload too large (קובץ גדול מדי)
- 400: Bad request (פורמט שגוי של Data URI)
- 422: Unprocessable entity (WA Sender דחה את האודיו)

---

## אינטגרציה עם הפייפליין הראשי

### שינויים ב-historyManager.ts

```typescript
// After getting OpenAI response...

// Always save text to history
await addToHistory(phone, {
  role: "assistant",
  content: response,
  timestamp: Date.now(),
});

// Attempt voice reply
let sentAsVoice = false;
if (config.voiceRepliesEnabled) {
  sentAsVoice = await handleVoiceReply({
    phone,
    responseText: response,
    incomingMessageType: batchMessages[0]?.message?.type || "text",
    conversationHistory: history,
  });
}

// Fallback to text if voice failed
if (!sentAsVoice) {
  await sendTextMessage(phone, response);
}
```

**עקרונות חשובים:**
1. תמיד שומרים **טקסט** ב-Redis (גם אם נשלח קול)
2. הקול הוא רק אלטרנטיבה לשליחה, לא לשמירה
3. ה-AI רואה את ההיסטוריה כטקסט בלבד
4. Fallback אוטומטי לטקסט אם הקול נכשל

---

## שליחת אודיו ל-WhatsApp - מדריך טכני מפורט

### למה Data URI ולא שרת חיצוני?

**בעבר (דרך מסורבלת):**
```
ElevenLabs → Download MP3 → Upload to Cloudinary/S3 → Get URL → Send URL to WA Sender
```
בעיות: איטי, יקר, מורכב, תלות בשירותים חיצוניים

**כעת (Data URI - פשוט ומהיר):**
```
ElevenLabs → Convert to Base64 → Wrap in Data URI → Send directly to WA Sender
```
יתרונות: מהיר, בחינם, פשוט, אין תלויות

### איך זה עובד?

**שלב 1: ElevenLabs מחזיר Buffer**
```typescript
const audioBuffer = await textToSpeech(text);
// audioBuffer = <Buffer 49 44 33 04 00 00 00 00 ... >
```

**שלב 2: המרה ל-Base64**
```typescript
const base64Audio = audioBuffer.toString("base64");
// base64Audio = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2Z..."
```

**שלב 3: יצירת Data URI**
```typescript
const dataUri = `data:audio/mpeg;base64,${base64Audio}`;
// dataUri = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2Z..."
```

**שלב 4: שליחה ל-WA Sender**
```typescript
await axios.post("/sendMessage", {
  phone: "972523006544",
  type: "audio",
  audio: {
    data: dataUri  // ← הקסם קורה כאן
  }
});
```

### מה WA Sender עושה עם זה?

1. מקבל את ה-Data URI
2. מפרק את ה-base64
3. ממיר חזרה ל-Buffer
4. שולח ל-WhatsApp כהודעת קול

**הלקוח רואה:** 🎤 הודעה קולית עם play button (בדיוק כמו הודעות קול רגילות)

### פורמטים נתמכים

**תקין (זה מה שאנחנו משתמשים):**
```json
{
  "type": "audio",
  "audio": {
    "data": "data:audio/mpeg;base64,XXX"
  }
}
```

**לא תקין (לא יעבוד):**
```json
// ❌ בלי "data:" prefix
"audio": { "data": "SUQzBAA..." }

// ❌ בלי "audio/mpeg"
"audio": { "data": "data:base64,XXX" }

// ❌ סתם base64 ללא עטיפה
"audio": "SUQzBAA..."

// ❌ type שגוי
"type": "voice"
```

### גבולות וגודל

**גודל אודיו טיפוסי מ-ElevenLabs:**
- טקסט קצר (20 מילים): ~30KB
- טקסט בינוני (50 מילים): ~60KB
- טקסט ארוך (100 מילים): ~100KB

**Base64 overhead:** +33% (100KB → 133KB base64)

**מגבלת WA Sender:** בדרך כלל 2MB (יותר מספיק!)

### בדיקות שצריך להריץ

**1. בדיקה בסיסית - אודיו מגיע:**
```bash
# שלח הודעת קול דרך המערכת
# בדוק שהלקוח מקבל play button
```

**2. בדיקת פורמט:**
```bash
# בדוק logs של WA Sender
# ודא שאין שגיאות 400/422
```

**3. בדיקת גודל:**
```typescript
logger.info("Audio sizes", {
  bufferSize: audioBuffer.length,
  base64Size: base64Audio.length,
  dataUriSize: dataUri.length
});
```

**4. בדיקת השמעה:**
```
# ודא שהאודיו מתנגן (לא רק מופיע)
# בדוק איכות קול
# בדוק שאין עיוותים
```

---

## Redis Data Schema

### Voice Tracking

**Key:** `customer:{phone}.sentRandomVoice`  
**Value:** `"true"` | null  
**TTL:** 7 days  
**Purpose:** מונע שליחת יותר מהודעת קול רנדומלית אחת בשיחה

---

## ביצועים ו-Latency

### זמני תגובה

```
Component                   Time (ms)
─────────────────────────────────────
AI Decision (random)        100-200
TTS Normalization           100-200
ElevenLabs TTS              400-700
Base64 Conversion           ~10
WA Sender Send (Data URI)   200-400
─────────────────────────────────────
Total Voice Pipeline        800-1500ms
```

**יתרונות Data URI:**
- אין העלאה לשרת חיצוני (חוסך 500-1000ms)
- אין תלות ב-Cloudinary/S3
- פשוט ומהיר יותר
- אין עלויות נוספות

### אופטימיזציה

- AI micro-modules משתמשים ב-gpt-4o-mini (מהיר וזול)
- Timeout protection על כל שלב
- Fallback אוטומטי לטקסט במקרה של כשל
- Parallel processing לא נדרש (sequential pipeline)

---

## טיפול בשגיאות

### Timeout Strategy

כל שלב מוגן ב-timeout:
- ElevenLabs: 10 שניות
- AI Normalization: תוך OpenAI timeout
- Voice Send: 45 שניות

**במקרה של timeout:** Fallback לטקסט רגיל.

### Retry Logic

- 429 (Rate Limit): עד 3 ניסיונות עם exponential backoff
- שגיאות אחרות: fallback מיידי לטקסט

### Graceful Degradation

```
Voice Pipeline Failed
    ↓
Log Warning
    ↓
Send Text Instead
    ↓
Customer Receives Response (Always)
```

---

## בדיקות

### בדיקות ידניות

1. **תשובה קולית לאחר הודעת קול:**
   ```
   לקוח: [שולח הודעת קול]
   סוכן: [עונה בקול] ✓
   ```

2. **תשובה רנדומלית פעם אחת:**
   ```
   לקוח: הודעה 1, 2, 3, 4, 5...
   סוכן: [טקסט, טקסט, טקסט, טקסט, קול פעם אחת]
   המשך: [טקסט בלבד, אין עוד קול]
   ```

3. **בדיקת פיצ'ר כבוי:**
   ```bash
   VOICE_REPLIES=off
   ```
   סוכן: [רק טקסט, תמיד]

### בדיקות קצה

- טקסט ארוך מאוד (500+ תווים)
- מספרים בפורמטים שונים
- אמוג'ים רבים
- שפות מעורבות (עברית + אנגלית)
- Latency גבוה ב-ElevenLabs

### Monitoring

בדוק logs:
```
Voice reply flow started - החלטה
Text normalized for TTS - נורמליזציה
TTS conversion successful - המרה לאודיו
Voice message sent successfully - שליחה
```

---

## כיבוי/הפעלה של הפיצ'ר

### כיבוי מלא

```bash
VOICE_REPLIES=off
```

המערכת תתעלם מכל הלוגיקה ותשלח רק טקסט.

### הפעלה ללא AI Decision

```bash
VOICE_REPLIES=on
RANDOM_VOICE_AI_CHECK=off
```

תשובה רנדומלית תישלח אוטומטית אחרי X הודעות (ללא בדיקת AI).

### התאמת threshold

```bash
MIN_MESSAGES_FOR_RANDOM_VOICE=10
```

שנה את מספר ההודעות הנדרש לפני תשובה רנדומלית.

---

## Troubleshooting

### Issue: Voice not sending

**בדיקות:**
1. `VOICE_REPLIES=on` ב-.env?
2. `ELEVENLABS_API_KEY` ו-`ELEVENLABS_VOICE_ID` מוגדרים?
3. בדוק logs: האם יש שגיאות מ-ElevenLabs?
4. בדוק מכסת ElevenLabs (characters quota)

### Issue: Poor Hebrew pronunciation

**פתרונות:**
1. בחר voice אחר מ-ElevenLabs (נסה קולות multilingual)
2. התאם prompts ב-ttsNormalizer.ts לשיפור נורמליזציה
3. בדוק את normalized text ב-logs

### Issue: Too slow

**אופטימיזציות:**
1. שקול להוריד `RANDOM_VOICE_AI_CHECK=off` (חוסך 100-200ms)
2. בדוק latency של ElevenLabs API (יכול להשתנות)
3. שקול להגדיל timeout אם נכשל לעיתים

### Issue: "Random voice already sent"

זה נורמלי - הפיצ'ר מתוכנן לשלוח רק פעם אחת בשיחה (7 ימים).

**איפוס ידני:**
```bash
redis-cli
> DEL "customer:0523006544.sentRandomVoice"
```

---

## עלויות

### ElevenLabs

- **Free Tier:** 10,000 characters/month
- **Starter:** $5/month - 30,000 characters
- **Creator:** $22/month - 100,000 characters

**הערכה:**
- תגובה ממוצעת: ~100 תווים
- Free tier: ~100 תגובות קוליות/חודש

### OpenAI (micro-modules)

- **Normalization:** ~50 tokens (gpt-4o-mini)
- **Decision:** ~20 tokens (gpt-4o-mini)
- עלות: ~$0.0001 per voice reply

**זניח לעומת GPT-4 הראשי.**

---

## Future Enhancements

רעיונות להרחבה:
1. בחירת קול דינמי לפי זמן יום
2. שליחת קול עם טקסט במקביל (למי שרוצה לקרוא)
3. אופטימיזציית cache ל-TTS (טקסטים דומים)
4. תמיכה בקולות מותאמים אישית (voice cloning)
5. A/B testing - מדידת conversion rate עם/בלי קול

---

## סיכום

הפיצ'ר Voice Reply System:
- מוסיף ממד אישי לשיחות
- פועל בצורה חכמה ולא פולשנית
- fallback מלא למקרה של כשל
- קל להפעלה/כיבוי
- ארכיטקטורה מסודרת ומודולרית

**הקוד מוכן לפרודקשן.**

