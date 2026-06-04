#!/usr/bin/env node
/*
 * Functional self-check for the karaoke ASS pipeline.
 *
 * Burns a karaoke ASS (in the same format buildAssContent produces) onto a
 * 5-second 1080×1920 black background using the SAME FFmpeg subtitles filter
 * the real render pipeline uses (subtitles=filename='…' with `:` escaped).
 *
 * If the output MP4 shows the words turning gold one at a time across the
 * 5 seconds, libass parsed our ASS and the karaoke effect works end-to-end.
 *
 * Run:    node scripts/karaoke-burn-check.mjs
 * Output: C:\Users\statt\cads\karaoke-check.mp4
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Inline duplicate of buildAssContent's output format — keeps the script
 *  dependency-free. The unit tests in assBuilder.test.ts already pin the
 *  builder; here we just need a structurally-valid karaoke ASS. */
function makeAss({ words, totalCs, frame }) {
  const perWord = Math.max(0, Math.floor(totalCs / words.length));
  const remainder = totalCs - perWord * words.length;
  const body = words
    .map((w, i) => `{\\k${perWord + (i < remainder ? 1 : 0)}}${w}`)
    .join(" ");
  const fontSize = Math.max(18, Math.round(frame.height * 0.045));
  return (
    `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `WrapStyle: 2\n` +
    `ScaledBorderAndShadow: yes\n` +
    `PlayResX: ${frame.width}\n` +
    `PlayResY: ${frame.height}\n` +
    `\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Karaoke,Arial,${fontSize},&H004AD8FF,&H00FFFFFF,&H80000000,&H61000000,1,0,0,0,100,100,0,0,3,2,0,2,40,40,80,1\n` +
    `\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    `Dialogue: 0,0:00:00.20,0:00:04.80,Karaoke,,0,0,0,,${body}\n`
  );
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..");
const dir = mkdtempSync(path.join(tmpdir(), "cads-karaoke-check-"));
const assPath = path.join(dir, "k.ass");
const totalCs = 460; // 4.60 s sweep
const ass = makeAss({
  words: ["Hello", "karaoke", "world", "this", "is", "C.A.D.S."],
  totalCs,
  frame: { width: 1080, height: 1920 },
});
writeFileSync(assPath, ass, "utf8");
console.log(`Wrote ASS → ${assPath} (${ass.length} bytes)`);
console.log("ASS preview:\n" + ass);

const out = path.join(repoRoot, "karaoke-check.mp4");
const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
const args = [
  "-f", "lavfi",
  "-i", "color=c=black:s=1080x1920:d=5:r=30",
  "-vf", `subtitles=filename='${safe}'`,
  "-t", "5",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-y", out,
];
console.log("Running ffmpeg …");
const r = spawnSync(process.env.CADS_FFMPEG_BIN ?? "ffmpeg", args, { stdio: "inherit" });
rmSync(dir, { recursive: true, force: true });
if (r.status !== 0) {
  console.error(`ffmpeg exited ${r.status}`);
  process.exit(1);
}
console.log(`\nOutput → ${out}\nOpen it: start "" "${out}"`);
