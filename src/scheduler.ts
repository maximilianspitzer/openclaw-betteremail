import type { WorkHoursConfig, PollIntervalConfig } from "./types.js";

export function isWorkHours(now: Date, config: WorkHoursConfig): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: config.timezone,
  });
  const hour = parseInt(formatter.format(now), 10);
  return hour >= config.start && hour < config.end;
}

export function getIntervalMs(
  now: Date,
  intervals: PollIntervalConfig,
  workConfig: WorkHoursConfig,
): number {
  const minutes = isWorkHours(now, workConfig) ? intervals.workHours : intervals.offHours;
  return minutes * 60 * 1000;
}

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private intervals: PollIntervalConfig;
  private workConfig: WorkHoursConfig;
  private onTick: () => Promise<void>;

  constructor(
    intervals: PollIntervalConfig,
    workConfig: WorkHoursConfig,
    onTick: () => Promise<void>,
  ) {
    this.intervals = intervals;
    this.workConfig = workConfig;
    this.onTick = onTick;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    const interval = getIntervalMs(new Date(), this.intervals, this.workConfig);
    this.timer = setTimeout(async () => {
      try {
        await this.onTick();
      } catch {
        // Pipeline handles its own errors — scheduler just keeps going
      }
      this.scheduleNext();
    }, interval);
  }
}
