/*
 * State-machine pin for the Motion-Graphic Inspector's Rebuild button.
 *
 * These tests are the contract the inline button JSX in MotionGraphicInspector
 * relies on: any change to the phase → (label, disabled, spinner) mapping
 * lands here first.
 */

import { describe, expect, it } from "vitest";
import {
  REBUILD_LABEL_BUSY,
  REBUILD_LABEL_ERROR,
  REBUILD_LABEL_IDLE,
  rebuildButtonState,
  type RebuildPhase,
} from "./rebuildButtonState";

describe("rebuildButtonState", () => {
  it("rebuilding → 'Rebuilding…', disabled, spinner showing", () => {
    expect(rebuildButtonState("rebuilding")).toEqual({
      label: REBUILD_LABEL_BUSY,
      disabled: true,
      showSpinner: true,
    });
  });

  it("previewing → 'Rebuild', disabled (queued behind preview), no spinner", () => {
    expect(rebuildButtonState("previewing")).toEqual({
      label: REBUILD_LABEL_IDLE,
      disabled: true,
      showSpinner: false,
    });
  });

  it.each<RebuildPhase>(["idle", "done"])(
    "resting phase %s → 'Rebuild', enabled, no spinner",
    (phase) => {
      expect(rebuildButtonState(phase)).toEqual({
        label: REBUILD_LABEL_IDLE,
        disabled: false,
        showSpinner: false,
      });
    },
  );

  it("error → distinct, VISIBLE failure state, still enabled so the click retries", () => {
    // The Inspector's catch lands on "error". The button must NOT look like the
    // plain resting state (that reads as "nothing happened" — the reported bug).
    const after = rebuildButtonState("error");
    expect(after.label).toBe(REBUILD_LABEL_ERROR);
    expect(after.label).not.toBe(REBUILD_LABEL_IDLE);
    expect(after.disabled).toBe(false); // enabled → retry
    expect(after.showSpinner).toBe(false);
    expect(after.error).toBe(true);
  });

  it("never stays stuck on 'Rebuilding…' after a failure", () => {
    expect(rebuildButtonState("error").label).not.toBe(REBUILD_LABEL_BUSY);
  });
});
