#!/usr/bin/env node
/*
 * Full-pipeline repro of the failing in-app short render:
 *   - Sweet Relief source MP4 (-ss/-to trim)
 *   - 3 motion-graphic WebM overlays (the actual overlay_001/2/3 on NAS)
 *   - 40 karaoke ASS captions
 *   - same crop/scale/overlay/subtitles filter graph as buildShortRenderArgs
 *   - same encode args as the "short" preset (medium/crf=20/yuv420p/aac)
 */

import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SRC = "C:/Users/statt/Videos/sweet-relief/source/GMT20260524-180128_Recording_1280x720.mp4";
const NAS = "//WoodrowNAS/Qualifelec/Stuart/Videos/Video Assets/motion_graphics";
const OVERLAYS = [
  { input: `${NAS}/overlay_001.webm`, outStart: 2.28, dur: 3 },
  { input: `${NAS}/overlay_002.webm`, outStart: 22.68, dur: 3 },
  { input: `${NAS}/overlay_003.webm`, outStart: 94.41, dur: 3 },
];
const IN = 31.16;
const OUT = 137.232;

const PROJ = "C:/Users/statt/Videos/emergency-cads-pod-sweet-relief/cads-project.json";
const proj = JSON.parse(readFileSync(PROJ, "utf8"));
const realCaptions = proj.events
  .filter((e) => e.kind === "caption" && e.enabled && e.captionData && e.start >= IN && e.start < OUT)
  .map((e) => ({ outStart: e.start - IN, duration: e.duration, text: e.captionData.text }));
console.log(`Loaded ${realCaptions.length} real caption texts from short_001 window`);

function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
function escAss(s) { return s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}"); }

const dialogues = realCaptions
  .map((c) => {
    const words = c.text.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const totalCs = Math.round(c.duration * 100);
    const perWord = Math.floor(totalCs / Math.max(1, words.length));
    const remainder = totalCs - perWord * words.length;
    const body = words.length === 1
      ? `{\\k${totalCs}}${escAss(words[0])}`
      : words.map((w, i) => `{\\k${perWord + (i < remainder ? 1 : 0)}}${escAss(w)}`).join(" ");
    return `Dialogue: 0,${assTime(c.outStart)},${assTime(c.outStart + c.duration)},Karaoke,,0,0,0,,${body}`;
  })
  .filter(Boolean)
  .join("\n");

const fontSize = Math.max(18, Math.round(1920 * 0.045));
const ass =
  `[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nScaledBorderAndShadow: yes\nPlayResX: 1080\nPlayResY: 1920\n\n` +
  `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
  `Style: Karaoke,Arial,${fontSize},&H004AD8FF,&H00FFFFFF,&H80000000,&H61000000,1,0,0,0,100,100,0,0,3,2,0,2,40,40,80,1\n\n` +
  `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + dialogues + "\n";

const dir = mkdtempSync(path.join(tmpdir(), "cads-fullrepro-"));
const assPath = path.join(dir, "k.ass");
writeFileSync(assPath, ass, "utf8");
console.log(`Wrote ASS (${realCaptions.length} cues) → ${assPath}`);

// Build the filter_complex EXACTLY like buildShortRenderArgs does.
const parts = ["[0:v]crop=w=ih*9/16:h=ih,scale=1080:1920,setpts=PTS-STARTPTS[base]"];
const scaleParts = [];
const chainParts = [];
let current = "[base]";
OVERLAYS.forEach((ov, i) => {
  const inputLabel = `[${i + 1}:v]`;
  const outLabel = i === OVERLAYS.length - 1 ? "[outv]" : `[ov${i}]`;
  const end = Number((ov.outStart + ov.dur).toFixed(3));
  const s = `[ovs${i}]`;
  scaleParts.push(`${inputLabel}scale=1080:1920${s}`);
  chainParts.push(`${current}${s}overlay=x=0:y=0:enable='between(t,${ov.outStart},${end})'${outLabel}`);
  current = outLabel;
});
const safe = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
const captionParts = [`${current}subtitles=filename='${safe}'[subs]`];

const filter = [...parts, ...scaleParts, ...chainParts, ...captionParts].join(";");

const out = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), ".."), "karaoke-fullrepro.mp4");
const args = [
  "-ss", String(IN),
  "-to", String(OUT),
  "-i", SRC,
];
for (const ov of OVERLAYS) args.push("-i", ov.input);
args.push(
  "-filter_complex", filter,
  "-map", "[subs]",
  "-map", "0:a",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-preset", "medium",
  "-crf", "20",
  "-c:a", "aac",
  "-y", out,
);

console.log("\n--- filter_complex ---");
console.log(filter);
console.log("\n--- ffmpeg argv ---");
console.log(" " + args.join(" "));

console.log("\nRunning…");
const r = spawnSync(process.env.CADS_FFMPEG_BIN ?? "ffmpeg", args, { encoding: "utf8" });
rmSync(dir, { recursive: true, force: true });
console.log("\n--- stderr (last 60 non-empty) ---");
console.log(
  (r.stderr ?? "").split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean).slice(-60).join("\n"),
);
console.log("\nExit:", r.status);
if (r.status !== 0) console.log("!! FAILED");
else console.log(`OK → ${out}`);
