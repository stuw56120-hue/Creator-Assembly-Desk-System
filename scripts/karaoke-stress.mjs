#!/usr/bin/env node
/*
 * Stress test: 40 sequential karaoke captions through the SAME FFmpeg
 * subtitles filter the real render uses. If this succeeds, the failure is
 * specific to the full short render pipeline (overlays / concat / scale /
 * map) — not the ASS file or the subtitles filter itself.
 *
 * Run:   node scripts/karaoke-stress.mjs
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function makeAss(captions, frame) {
  const dialogues = captions
    .map((c) => {
      const words = c.text.split(/\s+/).filter(Boolean);
      const totalCs = Math.round(c.duration * 100);
      const perWord = Math.floor(totalCs / words.length);
      const remainder = totalCs - perWord * words.length;
      const body = words
        .map((w, i) => `{\\k${perWord + (i < remainder ? 1 : 0)}}${w}`)
        .join(" ");
      return `Dialogue: 0,${assTime(c.start)},${assTime(c.start + c.duration)},Karaoke,,0,0,0,,${body}`;
    })
    .join("\n");
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
    dialogues + "\n"
  );
}

function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(c).padStart(2,"0")}`;
}

// 40 captions across 60 s with realistic Sweet-Relief-ish text.
const TEXTS = [
  "Let's get started.",
  "Alright, 3, 2, 1. Hello everybody, welcome to an emergency pod... yeah,",
  "let's start that again. 3, 2,",
  "Hello, welcome to an emergency CADS pod about Spurs.",
  "Postecoglou's back in the building.",
  "Kulusevski looked sharp today, I have to say.",
  "Son Heung-min with that finish — unbelievable.",
  "We need to talk about the midfield.",
  "Are we going to sign anyone in January? Probably not.",
  "Levy is Levy.",
];
const captions = [];
for (let i = 0; i < 40; i++) {
  captions.push({ start: i * 1.4 + 0.2, duration: 1.35, text: TEXTS[i % TEXTS.length] });
}

const dir = mkdtempSync(path.join(tmpdir(), "cads-karaoke-stress-"));
const assPath = path.join(dir, "k.ass");
const ass = makeAss(captions, { width: 1080, height: 1920 });
writeFileSync(assPath, ass, "utf8");
console.log(`Wrote ASS (${captions.length} cues, ${ass.length} bytes) → ${assPath}`);

const out = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), ".."), "karaoke-stress.mp4");
const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
const args = [
  "-f", "lavfi",
  "-i", "color=c=0x202030:s=1080x1920:d=60:r=30",
  "-vf", `subtitles=filename='${safe}'`,
  "-t", "60",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-pix_fmt", "yuv420p",
  "-y", out,
];
console.log("\nffmpeg argv:\n " + args.join(" "));
console.log("\nRunning ffmpeg …");
const r = spawnSync(process.env.CADS_FFMPEG_BIN ?? "ffmpeg", args, { encoding: "utf8" });
rmSync(dir, { recursive: true, force: true });
console.log("\n--- stderr tail ---");
console.log(r.stderr?.split(/\r?\n/).filter(Boolean).slice(-30).join("\n"));
console.log("\nExit:", r.status);
if (r.status !== 0) process.exit(1);
console.log(`\nOK. Output → ${out}`);
