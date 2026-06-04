import { beforeEach, describe, expect, it } from "vitest";
import { useOnboardingStore } from "./onboardingStore";
import type { RequiredAsset } from "../project/editListParser";

const required: RequiredAsset[] = [
  { asset_id: "asset_headshot", purpose: "Headshot", suggested_filename: "headshot", used_in: [], optional: false },
  { asset_id: "asset_logo", purpose: "Logo", suggested_filename: "brand-logo", used_in: [], optional: false },
  { asset_id: "asset_bg", purpose: "Background", suggested_filename: "bg", used_in: [], optional: true },
];

const VARIANTS = { original: "a.jpg", nobg: "a-nobg.png", bgBlur: "a-bg-blur.jpg" };

describe("useOnboardingStore", () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it("records and clears library matches keyed by asset id", () => {
    useOnboardingStore.getState().setRequiredAssets(required);
    useOnboardingStore
      .getState()
      .setRowLibraryMatch("asset_headshot", { suggestedFilename: "mathys-tel-action" });
    expect(useOnboardingStore.getState().libraryMatches.asset_headshot?.suggestedFilename).toBe(
      "mathys-tel-action",
    );
    // setRequiredAssets resets matches (a re-import gets a fresh hydrate).
    useOnboardingStore.getState().setRequiredAssets(required);
    expect(useOnboardingStore.getState().libraryMatches).toEqual({});
  });

  it("creates one pending row per required asset", () => {
    useOnboardingStore.getState().setRequiredAssets(required);
    const { rows } = useOnboardingStore.getState();
    expect(Object.keys(rows)).toHaveLength(3);
    expect(rows.asset_headshot.status).toBe("pending");
    expect(rows.asset_logo.status).toBe("pending");
    expect(rows.asset_bg.status).toBe("pending");
  });

  it("allRequiredDone is false while any non-optional row is not done", () => {
    useOnboardingStore.getState().setRequiredAssets(required);
    expect(useOnboardingStore.getState().allRequiredDone).toBe(false);

    useOnboardingStore.getState().setRowVariants("asset_headshot", VARIANTS);
    expect(useOnboardingStore.getState().allRequiredDone).toBe(false); // logo still pending
  });

  it("allRequiredDone is true once all non-optional rows are done (optional irrelevant)", () => {
    useOnboardingStore.getState().setRequiredAssets(required);
    useOnboardingStore.getState().setRowVariants("asset_headshot", VARIANTS);
    useOnboardingStore.getState().setRowVariants("asset_logo", VARIANTS);
    // asset_bg (optional) is still pending — should not block.
    expect(useOnboardingStore.getState().allRequiredDone).toBe(true);
  });

  it("skipOptional flips optional pending rows to done without touching required rows", () => {
    useOnboardingStore.getState().setRequiredAssets(required);
    useOnboardingStore.getState().skipOptional();
    const { rows } = useOnboardingStore.getState();
    expect(rows.asset_bg.status).toBe("done");
    expect(rows.asset_headshot.status).toBe("pending"); // required untouched
    expect(useOnboardingStore.getState().allRequiredDone).toBe(false);
  });

  it("setRowError records the error and status", () => {
    useOnboardingStore.getState().setRequiredAssets(required);
    useOnboardingStore.getState().setRowError("asset_headshot", "worker exploded");
    const row = useOnboardingStore.getState().rows.asset_headshot;
    expect(row.status).toBe("error");
    expect(row.error).toBe("worker exploded");
  });

  it("setRowProgress moves a row to processing with stage + percent", () => {
    useOnboardingStore.getState().setRequiredAssets(required);
    useOnboardingStore.getState().setRowProgress("asset_headshot", "Removing background", 67);
    const row = useOnboardingStore.getState().rows.asset_headshot;
    expect(row.status).toBe("processing");
    expect(row.progress).toEqual({ stage: "Removing background", percent: 67 });
  });

  it("treats an empty requirement set as already done", () => {
    useOnboardingStore.getState().setRequiredAssets([]);
    expect(useOnboardingStore.getState().allRequiredDone).toBe(true);
  });
});
