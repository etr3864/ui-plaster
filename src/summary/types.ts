export interface SummaryMeta {
  customerName: string;
  lastUserMessageAt: number;
  summarySent: boolean;
}

export interface SummaryPayload {
  customerName: string;
  phone: string;
  timestamp: string;
  summary: string;
}
