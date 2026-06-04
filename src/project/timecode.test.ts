import { describe, expect, it } from "vitest";
import { formatTimecode, isValidTimecode, parseTimecode } from "./timecode";

describe("parseTimecode", () => {
  it("parses MM:SS.s", () => {
    expect(parseTimecode("24:18.0")).toBe(1458);
    expect(parseTimecode("0:30.0")).toBe(30);
    expect(parseTimecode("2:01.5")).toBe(121.5);
  });

  it("parses HH:MM:SS.s", () => {
    expect(parseTimecode("1:02:03.5")).toBe(3723.5);
  });

  it("throws on malformed input", () => {
    expect(() => parseTimecode("not-a-time")).toThrow();
    expect(() => parseTimecode("12:99.0")).toThrow();
  });
});

describe("isValidTimecode", () => {
  it("accepts valid timecodes and rejects garbage", () => {
    expect(isValidTimecode("38:00.0")).toBe(true);
    expect(isValidTimecode("1:02:03.5")).toBe(true);
    expect(isValidTimecode("")).toBe(false);
    expect(isValidTimecode("90")).toBe(false);
  });
});

describe("formatTimecode", () => {
  it("round-trips with parseTimecode", () => {
    expect(formatTimecode(1458)).toBe("24:18.0");
    expect(formatTimecode(30)).toBe("0:30.0");
    expect(formatTimecode(3723.5)).toBe("1:02:03.5");
  });

  it("clamps non-finite/negative input to zero", () => {
    expect(formatTimecode(Number.NaN)).toBe("0:00.0");
    expect(formatTimecode(-5)).toBe("0:00.0");
  });
});
