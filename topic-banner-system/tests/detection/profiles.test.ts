import { describe, it, expect, beforeEach } from "vitest";
import { resolveProfile, getProfileNames, clearProfileCache } from "../../src/detection/profiles.js";

beforeEach(() => {
  clearProfileCache();
});

describe("resolveProfile", () => {
  it("loads the podcast profile", () => {
    const profile = resolveProfile("podcast");
    expect(profile.window_size_ms).toBe(45000);
    expect(profile.major_similarity_threshold).toBe(0.42);
    expect(profile.silence_boost_threshold_ms).toBe(1400);
  });

  it("loads the sports profile", () => {
    const profile = resolveProfile("sports");
    expect(profile.window_size_ms).toBe(20000);
    expect(profile.major_similarity_threshold).toBe(0.38);
    expect(profile.silence_boost_threshold_ms).toBe(900);
  });

  it("loads the documentary profile", () => {
    const profile = resolveProfile("documentary");
    expect(profile.window_size_ms).toBe(60000);
    expect(profile.major_similarity_threshold).toBe(0.45);
    expect(profile.silence_boost_threshold_ms).toBe(1800);
  });

  it("loads the interview profile with correct speaker_weight", () => {
    const profile = resolveProfile("interview");
    expect(profile.window_size_ms).toBe(40000);
    expect(profile.speaker_weight).toBe(1.8);
    expect(profile.silence_boost_threshold_ms).toBe(1200);
  });

  it("merges threshold overrides correctly", () => {
    const profile = resolveProfile("podcast", {
      major_similarity_threshold: 0.55,
    });
    expect(profile.major_similarity_threshold).toBe(0.55);
    expect(profile.window_size_ms).toBe(45000);
  });

  it("override does not mutate original profile", () => {
    resolveProfile("podcast", { major_similarity_threshold: 0.99 });
    clearProfileCache();
    const fresh = resolveProfile("podcast");
    expect(fresh.major_similarity_threshold).toBe(0.42);
  });

  it("throws for unknown profile name", () => {
    expect(() =>
      // @ts-expect-error testing invalid input
      resolveProfile("unknown_profile")
    ).toThrow(/Unknown detection profile/);
  });

  it("returns all required threshold fields", () => {
    const profile = resolveProfile("podcast");
    expect(typeof profile.window_size_ms).toBe("number");
    expect(typeof profile.window_overlap_ms).toBe("number");
    expect(typeof profile.min_topic_duration_ms).toBe("number");
    expect(typeof profile.major_similarity_threshold).toBe("number");
    expect(typeof profile.minor_similarity_threshold).toBe("number");
    expect(typeof profile.silence_boost_threshold_ms).toBe("number");
    expect(typeof profile.speaker_weight).toBe("number");
  });
});

describe("getProfileNames", () => {
  it("returns all four profile names", () => {
    const names = getProfileNames();
    expect(names).toContain("podcast");
    expect(names).toContain("sports");
    expect(names).toContain("documentary");
    expect(names).toContain("interview");
    expect(names).toHaveLength(4);
  });
});
