import type { AuditEntry } from "../types.js";

export function createAuditEntry(
  jobId: string,
  timecodeMs: number,
  state: string,
  reason: string
): AuditEntry {
  const totalSec = Math.floor(timecodeMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ms = timecodeMs % 1000;
  const timecode =
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;

  return {
    job_id: jobId,
    timecode,
    state,
    reason,
    timestamp: new Date().toISOString(),
  };
}

export class AuditLog {
  private entries: AuditEntry[] = [];

  record(jobId: string, timecodeMs: number, state: string, reason: string): void {
    this.entries.push(createAuditEntry(jobId, timecodeMs, state, reason));
  }

  getEntries(): readonly AuditEntry[] {
    return this.entries;
  }

  toJSON(): AuditEntry[] {
    return [...this.entries];
  }
}
