/*
 * Pure helpers for the Step 1 ingest pipeline: project-folder naming, the
 * FFmpeg audio-extraction args, the Whisper worker args, and the on-disk
 * submission layout. No Node/Electron deps so the path/arg logic is testable;
 * the IPC handler supplies the real fs + subprocess.
 */

export const WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v3"] as const;
export type WhisperModel = (typeof WHISPER_MODELS)[number];

export const ACCEPTED_VIDEO_EXT = ["mp4", "mov", "mkv", "webm", "m4v"];
export const ACCEPTED_TRANSCRIPT_EXT = ["vtt", "srt", "txt"];

/** Filesystem-safe project folder name. Falls back to "project" when empty. */
export function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

export function fileExtension(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isAcceptedVideo(filePath: string): boolean {
  return ACCEPTED_VIDEO_EXT.includes(fileExtension(filePath));
}

export function isAcceptedTranscript(filePath: string): boolean {
  return ACCEPTED_TRANSCRIPT_EXT.includes(fileExtension(filePath));
}

/**
 * FFmpeg args to strip audio to a clean 16 kHz mono WAV — the format Whisper
 * wants. (`join` is injected so this stays Node-free.)
 */
export function audioExtractArgs(videoPath: string, wavPath: string): string[] {
  return [
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-y",
    wavPath,
  ];
}

/** Whisper worker args. */
export function transcribeArgs(
  audioPath: string,
  transcriptPath: string,
  model: string,
  language: string,
): string[] {
  return [
    "--input",
    audioPath,
    "--output",
    transcriptPath,
    "--model",
    model,
    "--language",
    language,
  ];
}

export interface ProjectLayout {
  projectDir: string;
  sourceDir: string;
  submissionDir: string;
  audioPath: string;
  transcriptPath: string;
}

/** Resolve the on-disk layout for a project. `join` is injected (path.join). */
export function projectLayout(
  projectsFolder: string,
  projectName: string,
  join: (...parts: string[]) => string,
): ProjectLayout {
  const projectDir = join(projectsFolder, slugifyProjectName(projectName));
  const submissionDir = join(projectDir, "submission");
  return {
    projectDir,
    sourceDir: join(projectDir, "source"),
    submissionDir,
    audioPath: join(submissionDir, "audio.wav"),
    transcriptPath: join(submissionDir, "transcript.txt"),
  };
}
