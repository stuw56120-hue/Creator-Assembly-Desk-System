/*
 * Pure helpers for FFmpeg invocation logging + error surfacing.
 *
 * The handler captures FFmpeg's full stderr but historically returned only
 * `slice(-4)` of it on a non-zero exit — which is exactly the codec
 * end-of-encode statistics block, NOT the actual error line. These helpers
 * fix that and live in src/ so they can be unit-tested.
 */

/**
 * A shell-ish quoting of each arg for the pre-invocation log line.
 * Round-trippable into a PowerShell terminal for repro; double-quotes
 * embedded quotes with the PowerShell-friendly `""` escape.
 */
export function quoteForLog(arg: string): string {
  if (/[\s"'`<>|&;()$]/.test(arg) || arg.length === 0) {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return arg;
}

/** Format an argv array as a single readable command for the log file. */
export function formatFfmpegCommand(bin: string, args: string[]): string {
  return [bin, ...args].map(quoteForLog).join(" ");
}

/**
 * Last N non-empty stderr lines. Codec end-of-encode statistics (libx264 /
 * libvpx-vp9 / AAC) print ~30 lines of stats AFTER the real error line on
 * a failed run, so `slice(-4)` reliably misses it. 40 is enough to scroll
 * back past the stats block to the first meaningful "Error/Invalid/Could
 * not …" line.
 */
export function tailStderrLines(stderr: string, n: number): string {
  return stderr
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .slice(-n)
    .join("\n");
}

/**
 * Heuristic: scan stderr for the first line that looks like a real FFmpeg
 * error (vs codec stats / progress / muxer chatter). Surfaces it in the IPC
 * error message even when it's been buried under the stats block. Returns
 * null when nothing matches and the tail is good enough.
 */
export function findRealFfmpegError(stderr: string): string | null {
  const lines = stderr.replace(/\r\n/g, "\n").split("\n");
  // Patterns ordered most-specific first; anchored to libavfilter /
  // libavformat / libavcodec messages that actually carry the diagnosis.
  const PAT = [
    /Error (opening|writing|muxing|decoding|encoding|reinitializing|allocating)/i,
    /Invalid (argument|data|option|stream|parameters)/i,
    /Could not (open|write|find|allocate|read|seek)/i,
    /No (such|option|stream) /i,
    /Permission denied/i,
    /\[AVFilterGraph[^\]]*\] /i,
    /\[Parsed_[^\]]*\] /i,
    /Output file #0 (does not|is empty)/i,
    /Non-monotonic /i,
    /Cannot allocate memory/i,
    /Operation not permitted/i,
    /Subtitle codec/i,
    /Unable to (open|find)/i,
    /Header missing/i,
    /Conversion failed!/i,
  ];
  for (const line of lines) {
    for (const re of PAT) {
      if (re.test(line) && line.trim().length > 0) return line.trim();
    }
  }
  return null;
}
