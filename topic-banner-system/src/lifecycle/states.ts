export enum BannerState {
  DETECTED = "DETECTED",
  QUEUED = "QUEUED",
  ENTRANCE = "ENTRANCE",
  HOLD = "HOLD",
  EXIT = "EXIT",
  CLEANUP = "CLEANUP",
  ERROR = "ERROR",
  SUPPRESSED = "SUPPRESSED",
}

const ALLOWED_TRANSITIONS: ReadonlyMap<BannerState, ReadonlySet<BannerState>> =
  new Map([
    [
      BannerState.DETECTED,
      new Set([BannerState.QUEUED, BannerState.SUPPRESSED]),
    ],
    [
      BannerState.QUEUED,
      new Set([BannerState.ENTRANCE, BannerState.ERROR, BannerState.SUPPRESSED]),
    ],
    [
      BannerState.ENTRANCE,
      new Set([BannerState.HOLD, BannerState.ERROR, BannerState.SUPPRESSED]),
    ],
    [
      BannerState.HOLD,
      new Set([BannerState.EXIT, BannerState.ERROR, BannerState.SUPPRESSED]),
    ],
    [
      BannerState.EXIT,
      new Set([BannerState.CLEANUP, BannerState.ERROR]),
    ],
    [BannerState.CLEANUP, new Set<BannerState>()],
    [
      BannerState.ERROR,
      new Set([BannerState.QUEUED, BannerState.SUPPRESSED]),
    ],
    [BannerState.SUPPRESSED, new Set<BannerState>()],
  ]);

const MAX_RETRIES = 2;

export interface BannerStateRecord {
  state: BannerState;
  retryCount: number;
}

export function createStateRecord(): BannerStateRecord {
  return { state: BannerState.DETECTED, retryCount: 0 };
}

export function transition(
  record: BannerStateRecord,
  next: BannerState
): BannerStateRecord {
  const allowed = ALLOWED_TRANSITIONS.get(record.state);
  if (!allowed || !allowed.has(next)) {
    throw new Error(
      `Invalid transition: ${record.state} → ${next}`
    );
  }

  if (next === BannerState.ERROR) {
    const newRetryCount = record.retryCount + 1;
    if (newRetryCount > MAX_RETRIES) {
      return { state: BannerState.SUPPRESSED, retryCount: newRetryCount };
    }
    return { state: BannerState.ERROR, retryCount: newRetryCount };
  }

  return { state: next, retryCount: record.retryCount };
}

export function suppressDirectly(record: BannerStateRecord): BannerStateRecord {
  return { state: BannerState.SUPPRESSED, retryCount: record.retryCount };
}

export function canTransitionTo(
  from: BannerState,
  to: BannerState
): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}
