/*
 * Tests for the FFmpeg error-surfacing helpers. The original handler used
 * stderr.slice(-4), which on a failed encode always returns codec
 * end-of-encode stats ("ref B L1: 96.7%  3.3%", "kb/s:3682", "Qavg: 802",
 * "Conversion failed!") and NEVER the real error line. These helpers fix
 * that — pinned by tests so any regression to "just tail 4 lines" fails CI.
 */

import { describe, expect, it } from "vitest";
import {
  findRealFfmpegError,
  formatFfmpegCommand,
  quoteForLog,
  tailStderrLines,
} from "./ffmpegErrors";

const REAL_FAILURE_STDERR = `
ffmpeg version 8.1.1 Copyright (c) 2000-2025 the FFmpeg developers
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/source.mp4':
  Stream #0:0: Video: h264, yuv420p, 1280x720
  Stream #0:1: Audio: aac, 48000 Hz, stereo
[AVFilterGraph @ 0x12345] No such filter: 'bogusfilter'
[fc#0 @ 0x67890] Error parsing global options: Invalid argument
[Parsed_subtitles_3 @ 0xabcd] fontselect: (Arial, 700, 0) -> Arial-BoldMT
frame=  500 fps= 30 q=20.0 size=  1024KiB time=00:00:16.66
frame=  600 fps= 30 q=20.0 size=  1280KiB time=00:00:20.00
[libx264 @ 0xdef] frame I:6     Avg QP:16.78  size: 58015
[libx264 @ 0xdef] frame P:203   Avg QP:20.26  size: 17749
[libx264 @ 0xdef] frame B:541   Avg QP:21.93  size:  4356
[libx264 @ 0xdef] consecutive B-frames:  1.6%  4.0%  8.0% 86.4%
[libx264 @ 0xdef] ref B L1: 96.7%  3.3%
[libx264 @ 0xdef] kb/s:3682.68
[aac @ 0xfff] Qavg: 802.966
Conversion failed!
`.trim();

describe("quoteForLog", () => {
  it("leaves plain args bare", () => {
    expect(quoteForLog("ffmpeg")).toBe("ffmpeg");
    expect(quoteForLog("-i")).toBe("-i");
    expect(quoteForLog("source.mp4")).toBe("source.mp4");
  });

  it("quotes args containing spaces", () => {
    expect(quoteForLog("C:/Users/Joe Bloggs/file.mp4")).toBe('"C:/Users/Joe Bloggs/file.mp4"');
  });

  it("quotes args containing shell metacharacters", () => {
    expect(quoteForLog("a;b")).toBe('"a;b"');
    expect(quoteForLog("a|b")).toBe('"a|b"');
    expect(quoteForLog("a&b")).toBe('"a&b"');
    expect(quoteForLog("a$b")).toBe('"a$b"');
  });

  it("doubles embedded quotes (PowerShell-friendly)", () => {
    expect(quoteForLog('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes empty strings (so they aren't lost)", () => {
    expect(quoteForLog("")).toBe('""');
  });
});

describe("formatFfmpegCommand", () => {
  it("joins binary + args, applying quoteForLog to each", () => {
    const cmd = formatFfmpegCommand("ffmpeg", ["-i", "C:/Users/Joe Bloggs/in.mp4", "out.mp4"]);
    expect(cmd).toBe('ffmpeg -i "C:/Users/Joe Bloggs/in.mp4" out.mp4');
  });

  it("survives -filter_complex with quoted single quotes", () => {
    const cmd = formatFfmpegCommand("ffmpeg", [
      "-filter_complex",
      "[0:v]subtitles=filename='/tmp/x.srt':force_style='FontSize=20'[subs]",
    ]);
    expect(cmd).toContain("-filter_complex");
    expect(cmd).toContain('"[0:v]subtitles=filename=');
  });
});

describe("tailStderrLines", () => {
  it("returns the last N non-empty lines", () => {
    const out = tailStderrLines(REAL_FAILURE_STDERR, 3);
    expect(out.split("\n").length).toBe(3);
    expect(out).toContain("Conversion failed!");
    expect(out).toContain("Qavg: 802.966");
    expect(out).toContain("kb/s:3682.68");
  });

  it("strips empty lines (collapses progress chatter)", () => {
    expect(tailStderrLines("a\n\n\n\nb\n\n\n", 5)).toBe("a\nb");
  });

  it("handles CRLF line endings", () => {
    expect(tailStderrLines("a\r\nb\r\nc\r\n", 2)).toBe("b\nc");
  });

  it("returns the whole thing when N exceeds the line count", () => {
    expect(tailStderrLines("a\nb\nc", 100).split("\n").length).toBe(3);
  });

  it("returns empty for empty input", () => {
    expect(tailStderrLines("", 10)).toBe("");
  });
});

describe("findRealFfmpegError", () => {
  it("digs out the AVFilterGraph error from REAL stderr buried under codec stats", () => {
    const err = findRealFfmpegError(REAL_FAILURE_STDERR);
    expect(err).not.toBeNull();
    // The first matching pattern is the AVFilterGraph or 'No such filter' line.
    expect(err).toMatch(/(AVFilterGraph|No such filter)/);
  });

  it("matches 'Error muxing a packet' style errors", () => {
    const e = findRealFfmpegError("frame=1\n[mp4 @ 0x1] Error muxing a packet\nConversion failed!");
    expect(e).toContain("Error muxing a packet");
  });

  it("matches 'Invalid argument'", () => {
    const e = findRealFfmpegError("frame=1\nInvalid argument: -foo\nConversion failed!");
    expect(e).toContain("Invalid argument");
  });

  it("matches 'No such file or directory' via 'No such ' pattern", () => {
    const e = findRealFfmpegError("frame=1\nNo such file or directory: /tmp/missing.mp4\nConversion failed!");
    expect(e).toContain("No such file or directory");
  });

  it("matches '[Parsed_subtitles_*]' libass errors", () => {
    const e = findRealFfmpegError(
      "frame=1\n[Parsed_subtitles_3 @ 0xabc] Cannot read subtitles\nConversion failed!",
    );
    expect(e).toContain("Parsed_subtitles");
  });

  it("falls back to 'Conversion failed!' when nothing more specific matches", () => {
    expect(findRealFfmpegError("frame=1\nframe=2\nConversion failed!")).toContain("Conversion failed!");
  });

  it("returns null when stderr is empty or only progress", () => {
    expect(findRealFfmpegError("")).toBeNull();
    expect(findRealFfmpegError("frame=1\nframe=2\nframe=3")).toBeNull();
  });
});
