/**
 * Opt-Out System - Type Definitions
 */

export interface OptOutStatus {
  phone: string;
  unsubscribed: boolean;
  timestamp: number;
  reason?: string;
}

export interface OptOutDetection {
  isOptOut: boolean;
  confidence: "high" | "medium" | "low";
  detectedPhrase?: string;
}

