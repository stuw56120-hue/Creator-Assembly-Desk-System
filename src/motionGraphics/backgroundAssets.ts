/*
 * Pure / testable helpers for MG-background asset import.
 *
 * - Validate the user-picked file (extension allow-list + 10 MB cap).
 * - Generate a v4 UUID (RFC 4122) for the storage filename, no Node deps so it
 *   runs under both tsconfigs and works from the unit test runner.
 * - Read / write the JSON index that lives at
 *   <projectFolder>/assets/mg-backgrounds/index.json — kept here so both the
 *   handler (writes) and any future consumer (reads) share one shape.
 *
 * I/O happens in the Electron handler. This module is pure.
 */

/** Extensions accepted by the inspector's file picker and the IPC validator. */
export const ALLOWED_BG_EXTENSIONS: ReadonlySet<string> = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);

/** Hard upload size cap (per spec). */
export const MAX_BG_BYTES = 10 * 1024 * 1024;

export type BackgroundFit = "cover" | "contain" | "tile";
export const ALLOWED_BG_FITS: ReadonlySet<BackgroundFit> = new Set(["cover", "contain", "tile"]);

export interface BackgroundIndexEntry {
  id: string;
  original_filename: string;
  ext: string; // lowercase, with leading dot
  bytes: number;
  created_at: string; // ISO-8601
}

export interface BackgroundIndexFile {
  entries: BackgroundIndexEntry[];
}

export type ValidationResult =
  | { ok: true; ext: string }
  | { ok: false; error: string };

/**
 * Validate a file the user just picked: extension on the allow-list,
 * byte-size under the cap. Both messages are plain-English so the inspector
 * can show them inline as the spec requires.
 */
export function validateBackgroundUpload(filename: string, bytes: number): ValidationResult {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  if (!ALLOWED_BG_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: `Unsupported format “${ext || "(no extension)"}”. Use JPG, PNG, or WebP.`,
    };
  }
  if (bytes > MAX_BG_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `Image is too large (${mb} MB). Max 10 MB.` };
  }
  return { ok: true, ext };
}

/**
 * Generate an RFC 4122 v4 UUID without pulling in `node:crypto` — the helper
 * runs in the renderer's test harness too. Falls back to Math.random when
 * crypto.getRandomValues is unavailable (Vitest provides it).
 */
export function uuidV4(): string {
  const bytes = new Uint8Array(16);
  // jsdom's crypto.getRandomValues is fine; the Node fallback covers test env.
  const c: { getRandomValues?: (b: Uint8Array) => void } | undefined =
    (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => void } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Variant + version bits per RFC 4122 §4.4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

/**
 * Add a new entry to an existing index file's contents. Pure — the caller is
 * responsible for the disk write. Re-emits the entries in insertion order; no
 * dedup (per spec: same image uploaded twice = two entries).
 */
export function appendBackgroundEntry(
  existing: BackgroundIndexFile | null,
  entry: BackgroundIndexEntry,
): BackgroundIndexFile {
  const prev = existing?.entries ?? [];
  return { entries: [...prev, entry] };
}

/** Parse a JSON index file safely; missing / malformed → empty index. */
export function parseBackgroundIndex(raw: string | null): BackgroundIndexFile {
  if (!raw) return { entries: [] };
  try {
    const data = JSON.parse(raw) as { entries?: unknown };
    if (!Array.isArray(data.entries)) return { entries: [] };
    const entries: BackgroundIndexEntry[] = [];
    for (const e of data.entries) {
      if (
        e &&
        typeof e === "object" &&
        typeof (e as BackgroundIndexEntry).id === "string" &&
        typeof (e as BackgroundIndexEntry).ext === "string"
      ) {
        entries.push(e as BackgroundIndexEntry);
      }
    }
    return { entries };
  } catch {
    return { entries: [] };
  }
}

/** Clamp opacity to the 0–100 range the spec promises. */
export function clampBackgroundOpacity(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 30;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Default Fit when none stored — picked by the spec. */
export const DEFAULT_BG_FIT: BackgroundFit = "cover";
export const DEFAULT_BG_OPACITY = 30;
