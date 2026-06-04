#!/usr/bin/env node
/*
 * Reproduces the EXACT FFmpeg invocation buildShortRenderArgs makes for an
 * ASS-only karaoke render — same filter graph (crop + scale + setpts +
 * subtitles), same -map list, same encode flags from the "short" preset —
 * pointed at Sweet Relief's real source MP4. If this fails with the same
 * "Conversion failed!" as the in-app render, we have a minimal repro outside
 * the Electron event loop.
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SRC = "C:/Users/statt/Videos/sweet-relief/source/GMT20260524-180128_Recording_1280x720.mp4";
const IN = 100; // -ss seconds
const OUT = 130; // -to seconds (30s short)

const captionTexts = [
  "Let's get started.",
  "Hello, welcome to an emergency CADS pod about Spurs.",
  "Postecoglou's back in the building.",
  "Kulusevski looked sharp today, I have to say.",
  "Son Heung-min with that finish, unbelievable.",
  "We need to talk about the midfield.",
  "Are we going to sign anyone in January?",
  "Probably not. Levy is Levy.",
];

function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

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
      return `Dialogue: 0,${assTime(c.outStart)},${assTime(c.outStart + c.duration)},Karaoke,,0,0,0,,${body}`;
    })
    .join("\n");
  const fontSize = Math.max(18, Math.round(frame.height * 0.045));
  return (
    `[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nScaledBorderAndShadow: yes\nPlayResX: ${frame.width}\nPlayResY: ${frame.height}\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Karaoke,Arial,${fontSize},&H004AD8FF,&H00FFFFFF,&H80000000,&H61000000,1,0,0,0,100,100,0,0,3,2,0,2,40,40,80,1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    dialogues + "\n"
  );
}

// Build short-local captions (outStart relative to IN).
const captions = captionTexts.map((t, i) => ({
  outStart: i * 3 + 0.5,
  duration: 2.8,
  text: t,
}));

const dir = mkdtempSync(path.join(tmpdir(), "cads-short-repro-"));
const assPath = path.join(dir, "k.ass");
writeFileSync(assPath, makeAss(captions, { width: 1080, height: 1920 }), "utf8");
console.log(`Wrote ASS → ${assPath}`);

const out = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), ".."), "karaoke-short-repro.mp4");
const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
const filter =
  `[0:v]crop=w=ih*9/16:h=ih,scale=1080:1920,setpts=PTS-STARTPTS[base];` +
  `[base]subtitles=filename='${safe}'[subs]`;

// Same flags as the "short" preset (see src/config/presets.ts) — verify by reading the file.
const args = [
  "-ss", String(IN),
  "-to", String(OUT),
  "-i", SRC,
  "-filter_complex", filter,
  "-map", "[subs]",
  "-map", "0:a",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "23",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-b:a", "128k",
  "-movflags", "+faststart",
  "-y", out,
];
console.log("\nffmpeg argv:");
console.log(" " + args.join(" "));
console.log("\nRunning…");
const r = spawnSync(process.env.CADS_FFMPEG_BIN ?? "ffmpeg", args, { encoding: "utf8" });
rmSync(dir, { recursive: true, force: true });
console.log("\n--- stderr (last 60 non-empty lines) ---");
console.log(
  (r.stderr ?? "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-60)
    .join("\n"),
);
console.log("\nExit:", r.status);
if (r.status !== 0) {
  console.log("\n!! FAILED — same shape as the in-app failure.");
  process.exit(1);
}
console.log(`\nOK. Output → ${out}`);
