import { BannerState, createStateRecord, transition, suppressDirectly, type BannerStateRecord } from "./states.js";
import { AuditLog } from "./audit_log.js";
import type { BannerEvent } from "../schema/banner_event.js";

export interface QueuedBanner {
  event: BannerEvent;
  record: BannerStateRecord;
  timecodeMs: number;
}

export class BannerQueue {
  private items: QueuedBanner[] = [];

  constructor(private readonly auditLog: AuditLog, private readonly jobId: string) {}

  enqueue(event: BannerEvent, timecodeMs: number): void {
    const record = createStateRecord();
    this.items.push({ event, record, timecodeMs });
  }

  advance(index: number, next: BannerState): void {
    const item = this.items[index];
    if (!item) throw new Error(`No item at index ${index}`);
    item.record = transition(item.record, next);

    if (item.record.state === BannerState.SUPPRESSED || item.record.state === BannerState.ERROR) {
      this.auditLog.record(this.jobId, item.timecodeMs, item.record.state, `transitioned to ${item.record.state}`);
    }
  }

  suppress(index: number, reason: string): void {
    const item = this.items[index];
    if (!item) throw new Error(`No item at index ${index}`);
    item.record = suppressDirectly(item.record);
    this.auditLog.record(this.jobId, item.timecodeMs, BannerState.SUPPRESSED, reason);
  }

  getItems(): readonly QueuedBanner[] {
    return this.items;
  }

  getActive(): QueuedBanner[] {
    return this.items.filter(
      (i) =>
        i.record.state !== BannerState.SUPPRESSED &&
        i.record.state !== BannerState.CLEANUP
    );
  }
}
