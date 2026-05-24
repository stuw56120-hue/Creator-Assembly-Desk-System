import { describe, it, expect } from "vitest";
import {
  BannerState,
  createStateRecord,
  transition,
  suppressDirectly,
  canTransitionTo,
} from "../../src/lifecycle/states.js";

describe("createStateRecord", () => {
  it("starts in DETECTED state with 0 retries", () => {
    const record = createStateRecord();
    expect(record.state).toBe(BannerState.DETECTED);
    expect(record.retryCount).toBe(0);
  });
});

describe("valid transitions", () => {
  it("DETECTED → QUEUED", () => {
    const record = transition(createStateRecord(), BannerState.QUEUED);
    expect(record.state).toBe(BannerState.QUEUED);
  });

  it("DETECTED → SUPPRESSED", () => {
    const record = transition(createStateRecord(), BannerState.SUPPRESSED);
    expect(record.state).toBe(BannerState.SUPPRESSED);
  });

  it("QUEUED → ENTRANCE", () => {
    let r = transition(createStateRecord(), BannerState.QUEUED);
    r = transition(r, BannerState.ENTRANCE);
    expect(r.state).toBe(BannerState.ENTRANCE);
  });

  it("full happy path: DETECTED → QUEUED → ENTRANCE → HOLD → EXIT → CLEANUP", () => {
    let r = createStateRecord();
    r = transition(r, BannerState.QUEUED);
    r = transition(r, BannerState.ENTRANCE);
    r = transition(r, BannerState.HOLD);
    r = transition(r, BannerState.EXIT);
    r = transition(r, BannerState.CLEANUP);
    expect(r.state).toBe(BannerState.CLEANUP);
  });
});

describe("invalid transitions", () => {
  it("DETECTED → ENTRANCE throws", () => {
    expect(() =>
      transition(createStateRecord(), BannerState.ENTRANCE)
    ).toThrow(/Invalid transition/);
  });

  it("CLEANUP → QUEUED throws", () => {
    let r = createStateRecord();
    r = transition(r, BannerState.QUEUED);
    r = transition(r, BannerState.ENTRANCE);
    r = transition(r, BannerState.HOLD);
    r = transition(r, BannerState.EXIT);
    r = transition(r, BannerState.CLEANUP);
    expect(() => transition(r, BannerState.QUEUED)).toThrow(/Invalid transition/);
  });

  it("SUPPRESSED → anything throws", () => {
    let r = transition(createStateRecord(), BannerState.SUPPRESSED);
    expect(() => transition(r, BannerState.QUEUED)).toThrow(/Invalid transition/);
  });
});

describe("error and retry logic", () => {
  it("first ERROR increments retryCount", () => {
    let r = transition(createStateRecord(), BannerState.QUEUED);
    r = transition(r, BannerState.ERROR);
    expect(r.state).toBe(BannerState.ERROR);
    expect(r.retryCount).toBe(1);
  });

  it("second ERROR increments retryCount to 2", () => {
    let r = transition(createStateRecord(), BannerState.QUEUED);
    r = transition(r, BannerState.ERROR);
    r = transition(r, BannerState.QUEUED);
    r = transition(r, BannerState.ERROR);
    expect(r.state).toBe(BannerState.ERROR);
    expect(r.retryCount).toBe(2);
  });

  it("third ERROR (exceeding max retries) → SUPPRESSED", () => {
    let r = transition(createStateRecord(), BannerState.QUEUED);
    r = transition(r, BannerState.ERROR);
    r = transition(r, BannerState.QUEUED);
    r = transition(r, BannerState.ERROR);
    r = transition(r, BannerState.QUEUED);
    r = transition(r, BannerState.ERROR);
    expect(r.state).toBe(BannerState.SUPPRESSED);
  });

  it("ERROR → QUEUED retry is valid", () => {
    let r = transition(createStateRecord(), BannerState.QUEUED);
    r = transition(r, BannerState.ERROR);
    r = transition(r, BannerState.QUEUED);
    expect(r.state).toBe(BannerState.QUEUED);
  });
});

describe("suppressDirectly", () => {
  it("immediately moves to SUPPRESSED regardless of state", () => {
    let r = transition(createStateRecord(), BannerState.QUEUED);
    r = transition(r, BannerState.ENTRANCE);
    r = suppressDirectly(r);
    expect(r.state).toBe(BannerState.SUPPRESSED);
  });
});

describe("canTransitionTo", () => {
  it("returns true for valid transitions", () => {
    expect(canTransitionTo(BannerState.DETECTED, BannerState.QUEUED)).toBe(true);
    expect(canTransitionTo(BannerState.QUEUED, BannerState.ENTRANCE)).toBe(true);
  });

  it("returns false for invalid transitions", () => {
    expect(canTransitionTo(BannerState.DETECTED, BannerState.HOLD)).toBe(false);
    expect(canTransitionTo(BannerState.CLEANUP, BannerState.DETECTED)).toBe(false);
  });
});
