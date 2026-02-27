// -- Plugin config --

export interface PollIntervalConfig {
  workHours: number;
  offHours: number;
}

export interface WorkHoursConfig {
  start: number;
  end: number;
  timezone: string;
}

export interface PluginConfig {
  accounts: string[];
  pollIntervalMinutes: PollIntervalConfig;
  workHours: WorkHoursConfig;
  classifierTimeoutMs: number;
  consecutiveFailuresBeforeAlert: number;
  rescanDaysOnHistoryReset: number;
}

// -- Raw email from gog CLI --

export interface RawGogMessage {
  id: string;
  threadId: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  body?: string;
  labelIds?: string[];
  [key: string]: unknown;
}

export interface RawGogThread {
  id: string;
  messages: RawGogMessage[];
}

// -- Trimmed email ready for classification --

export interface TrimmedEmail {
  id: string;
  threadId: string;
  account: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  threadLength: number;
  hasAttachments: boolean;
}

// -- Classification result --

export type ImportanceLevel = "high" | "medium" | "low";

export interface ClassificationResult {
  id: string;
  importance: ImportanceLevel;
  reason: string;
  notify: boolean;
}

// -- Digest entry --

export type DigestStatus = "new" | "surfaced" | "deferred" | "handled" | "dismissed";

export interface DigestEntry {
  id: string;
  threadId: string;
  account: string;
  from: string;
  subject: string;
  date: string;
  body: string;
  importance: "high" | "medium";
  reason: string;
  notify: boolean;
  status: DigestStatus;
  firstSeenAt: string;
  surfacedAt?: string;
  deferredUntil?: string;
  resolvedAt?: string;
  dismissReason?: string;
}

// -- Digest state file --

export interface DigestState {
  entries: Record<string, DigestEntry>;
}

// -- Polling state file --

export interface AccountState {
  historyId: string;
  lastPollAt: string;
  consecutiveFailures: number;
}

export interface PollState {
  accounts: Record<string, AccountState>;
  lastClassifierRunAt: string;
}

// -- Email log entry (emails.jsonl) --

export interface EmailLogEntry {
  email: TrimmedEmail;
  importance: ImportanceLevel;
  reason: string;
  notify: boolean;
  timestamp: number;
}
