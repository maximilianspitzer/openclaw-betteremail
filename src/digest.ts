import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DigestEntry, DigestState, DigestStatus } from "./types.js";
import { atomicWrite } from "./atomic.js";

const DIGEST_FILE = "digest.json";

export class DigestManager {
  private filePath: string;
  private state: DigestState;
  private saving = false;
  private saveQueue: (() => void)[] = [];

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, DIGEST_FILE);
    this.state = { entries: {} };
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as DigestState;
    } catch {
      this.state = { entries: {} };
    }
  }

  async save(): Promise<void> {
    if (this.saving) {
      await new Promise<void>((resolve) => this.saveQueue.push(resolve));
    }
    this.saving = true;
    try {
      await atomicWrite(this.filePath, JSON.stringify(this.state, null, 2) + "\n");
    } finally {
      this.saving = false;
      const next = this.saveQueue.shift();
      if (next) next();
    }
  }

  add(entry: DigestEntry): void {
    this.state.entries[entry.id] = entry;
  }

  get(id: string): DigestEntry | undefined {
    return this.state.entries[id];
  }

  has(id: string): boolean {
    return id in this.state.entries;
  }

  getByStatus(status: DigestStatus | "all"): DigestEntry[] {
    const entries = Object.values(this.state.entries);
    if (status === "all") return entries;
    return entries.filter((e) => e.status === status);
  }

  getGroupedByAccount(status: DigestStatus | "all"): Record<string, DigestEntry[]> {
    const entries = this.getByStatus(status);
    const grouped: Record<string, DigestEntry[]> = {};
    for (const entry of entries) {
      if (!grouped[entry.account]) grouped[entry.account] = [];
      grouped[entry.account].push(entry);
    }
    return grouped;
  }

  getActiveThreadIds(): DigestEntry[] {
    return Object.values(this.state.entries).filter(
      (e) => e.status === "surfaced" || e.status === "deferred",
    );
  }

  markSurfaced(id: string): void {
    const entry = this.state.entries[id];
    if (entry) {
      entry.status = "surfaced";
      entry.surfacedAt = new Date().toISOString();
    }
  }

  markHandled(id: string): void {
    const entry = this.state.entries[id];
    if (entry) {
      entry.status = "handled";
      entry.resolvedAt = new Date().toISOString();
    }
  }

  defer(id: string, minutes: number): void {
    const entry = this.state.entries[id];
    if (entry) {
      entry.status = "deferred";
      entry.deferredUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    }
  }

  dismiss(id: string, reason?: string): void {
    const entry = this.state.entries[id];
    if (entry) {
      entry.status = "dismissed";
      entry.resolvedAt = new Date().toISOString();
      if (reason) entry.dismissReason = reason;
    }
  }

  expireDeferrals(): DigestEntry[] {
    const now = new Date();
    const expired: DigestEntry[] = [];
    for (const entry of Object.values(this.state.entries)) {
      if (entry.status === "deferred" && entry.deferredUntil && new Date(entry.deferredUntil) <= now) {
        entry.status = "new";
        entry.deferredUntil = undefined;
        expired.push(entry);
      }
    }
    return expired;
  }
}
