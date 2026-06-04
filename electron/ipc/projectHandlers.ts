/*
 * Electron IPC — project setup, ingest orchestration, and file dialogs.
 *
 *   settings:get / settings:set   one-time Projects + Asset Library folders
 *   dialog:pickFolder / pickFile  native pickers
 *   project:openPath              reveal a folder/file in the OS
 *   project:readText              read a chosen edit-list file for import
 *   ingest:run                    copy video → extract audio → Whisper → submission
 *
 * ingest:run streams progress to the renderer via "ingest:log".
 */

import { ipcMain, app, dialog, shell, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { readFile, writeFile, mkdir, copyFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnStreaming } from "./spawnUtil";
import { runTranscribe } from "./transcribeHandlers";
import { writeLog } from "../logger";
import { audioExtractArgs, projectLayout } from "../../src/project/ingestPlan";

const FFMPEG_BIN = process.env.CADS_FFMPEG_BIN ?? "ffmpeg";
const INGEST_MANIFEST = "cads-ingest.json";

interface CadsSettings {
  projectsFolder?: string;
  assetLibraryFolder?: string;
  /** Project dir of the most recent successful ingest (for "Continue from last ingest"). */
  lastIngestDir?: string;
}

interface IngestManifest {
  version: number;
  projectName: string;
  projectDir: string;
  submissionDir: string;
  transcriptPath: string;
  audioPath: string;
  sourceVideoPath: string;
  createdAt: string;
}

/** Read + validate an ingest manifest from a project dir (transcript must still exist). */
async function readIngestManifest(projectDir: string): Promise<IngestManifest | null> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(projectDir, INGEST_MANIFEST), "utf8"),
    ) as IngestManifest;
    await stat(manifest.transcriptPath); // throws if the transcript is gone
    return manifest;
  } catch {
    return null;
  }
}

const VIDEO_EXT_RE = /\.(mp4|mov|mkv|webm|m4v)$/i;

/**
 * Resolve a resumable ingest from a project dir: prefer the manifest, else
 * reconstruct from the standard folder layout (submission/transcript.txt). This
 * lets pre-manifest ingests (or ones whose UI was reset) still be continued.
 */
async function resolveIngest(projectDir: string): Promise<IngestManifest | null> {
  const fromManifest = await readIngestManifest(projectDir);
  if (fromManifest) return fromManifest;

  const submissionDir = path.join(projectDir, "submission");
  const transcriptPath = path.join(submissionDir, "transcript.txt");
  try {
    await stat(transcriptPath); // no transcript → not a resumable ingest
  } catch {
    return null;
  }

  let sourceVideoPath = "";
  try {
    const sourceDir = path.join(projectDir, "source");
    const found = (await readdir(sourceDir)).find((f) => VIDEO_EXT_RE.test(f));
    if (found) sourceVideoPath = path.join(sourceDir, found);
  } catch {
    /* no source dir — render just won't have a video path */
  }

  return {
    version: 1,
    projectName: path.basename(projectDir),
    projectDir,
    submissionDir,
    transcriptPath,
    audioPath: path.join(submissionDir, "audio.wav"),
    sourceVideoPath,
    createdAt: new Date().toISOString(),
  };
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "cads-settings.json");
}

async function readSettings(): Promise<CadsSettings> {
  try {
    return JSON.parse(await readFile(settingsPath(), "utf8")) as CadsSettings;
  } catch {
    return {};
  }
}

async function writeSettings(patch: CadsSettings): Promise<CadsSettings> {
  const next = { ...(await readSettings()), ...patch };
  await mkdir(path.dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

interface IngestArgs {
  projectName: string;
  videoPath: string;
  vttPath?: string;
  language: string;
  model: string;
}

export function registerProjectHandlers(): void {
  ipcMain.handle("settings:get", () => readSettings());
  ipcMain.handle("settings:set", (_e, patch: CadsSettings) => writeSettings(patch));

  ipcMain.handle("dialog:pickFolder", async (e, args: { title?: string }) => {
    const r = await dialog.showOpenDialog(senderWindow(e)!, {
      title: args?.title,
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle(
    "dialog:pickFile",
    async (e, args: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
      const r = await dialog.showOpenDialog(senderWindow(e)!, {
        title: args?.title,
        filters: args?.filters,
        properties: ["openFile"],
      });
      return r.canceled ? null : r.filePaths[0];
    },
  );

  ipcMain.handle("project:openPath", (_e, args: { target: string }) => shell.openPath(args.target));
  ipcMain.handle("project:readText", (_e, args: { filePath: string }) =>
    readFile(args.filePath, "utf8"),
  );

  // Does a file exist and have content? Used by the Video Source step to show a
  // green tick vs. a "locate it" picker.
  ipcMain.handle("project:fileExists", async (_e, args: { filePath: string }) => {
    if (!args.filePath) return false;
    try {
      const s = await stat(args.filePath);
      return s.isFile() && s.size > 0;
    } catch {
      return false;
    }
  });

  // Resume the most recent completed ingest (settings pointer) without re-Whisper.
  ipcMain.handle("ingest:last", async () => {
    const settings = await readSettings();
    return settings.lastIngestDir ? resolveIngest(settings.lastIngestDir) : null;
  });

  // Inspect a chosen project folder: a saved editor snapshot, a resumable
  // ingest (manifest or reconstructed), or neither.
  ipcMain.handle("project:open", async (_e, args: { dir: string }) => {
    try {
      const snapshot = JSON.parse(await readFile(path.join(args.dir, "cads-project.json"), "utf8"));
      return { kind: "snapshot" as const, snapshot };
    } catch {
      /* not a saved snapshot — fall through */
    }
    const manifest = await resolveIngest(args.dir);
    if (manifest) return { kind: "ingest" as const, manifest };
    return { kind: "none" as const };
  });

  // Save a mid-edit snapshot to <projectsFolder>/<slug>/cads-project.json.
  ipcMain.handle(
    "project:save",
    async (_e, args: { projectName: string; snapshot: unknown }) => {
      const settings = await readSettings();
      if (!settings.projectsFolder) {
        throw new Error("No Projects folder is configured. Complete first-time setup first.");
      }
      const layout = projectLayout(settings.projectsFolder, args.projectName, path.join);
      await mkdir(layout.projectDir, { recursive: true });
      const filePath = path.join(layout.projectDir, "cads-project.json");
      await writeFile(filePath, JSON.stringify(args.snapshot, null, 2), "utf8");
      return { path: filePath };
    },
  );

  ipcMain.handle("ingest:run", async (event, args: IngestArgs) => {
    // Stream to the UI and persist the play-by-play to the log file.
    const log = (line: string, percent?: number) => {
      event.sender.send("ingest:log", { line, percent });
      if (percent == null) writeLog("INGEST", line); // skip the per-percent flood
    };

    writeLog(
      "INGEST",
      `ingest:run start — project="${args.projectName}", video="${args.videoPath}", model=${args.model}, language=${args.language}`,
    );

    try {
      return await runIngest(args, log);
    } catch (err) {
      writeLog("ERROR", "ingest:run failed:", err);
      throw err; // surface the clean message to the renderer too
    }
  });
}

async function runIngest(
  args: IngestArgs,
  log: (line: string, percent?: number) => void,
): Promise<{
  projectName: string;
  projectDir: string;
  submissionDir: string;
  transcriptPath: string;
  audioPath: string;
  sourceVideoPath: string;
}> {
  {
    const settings = await readSettings();
    if (!settings.projectsFolder) {
      throw new Error("No Projects folder is configured. Complete first-time setup first.");
    }

    const layout = projectLayout(settings.projectsFolder, args.projectName, path.join);
    await mkdir(layout.sourceDir, { recursive: true });
    await mkdir(layout.submissionDir, { recursive: true });
    log(`Creating project at ${layout.projectDir}`);

    // Copy the source video — the user's original is never touched.
    const videoDest = path.join(layout.sourceDir, path.basename(args.videoPath));
    log("Copying source video…");
    await copyFile(args.videoPath, videoDest);

    if (args.vttPath) {
      log("Copying Zoom transcript…");
      await copyFile(args.vttPath, path.join(layout.sourceDir, path.basename(args.vttPath)));
    }

    log("Extracting audio (16 kHz mono WAV)…");
    await spawnStreaming(FFMPEG_BIN, audioExtractArgs(videoDest, layout.audioPath), () => {});
    log("Audio extracted.");

    log(`Transcribing with Whisper (${args.model})…`);
    const result = await runTranscribe(
      layout.audioPath,
      layout.transcriptPath,
      args.model,
      args.language,
      (stage, percent) => log(`${stage}… ${percent}%`, percent),
    );
    log(`Transcript ready — ${result.segment_count} segments, ${result.duration}s.`);

    const manifest: IngestManifest = {
      version: 1,
      projectName: args.projectName,
      projectDir: layout.projectDir,
      submissionDir: layout.submissionDir,
      transcriptPath: layout.transcriptPath,
      audioPath: layout.audioPath,
      sourceVideoPath: videoDest,
      createdAt: new Date().toISOString(),
    };
    // Persist a manifest so a completed ingest can be resumed without re-running
    // Whisper (e.g. if the UI was reset), and remember it as the "last ingest".
    await writeFile(
      path.join(layout.projectDir, INGEST_MANIFEST),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    await writeSettings({ lastIngestDir: layout.projectDir });
    log("Submission folder ready.");

    return manifest;
  }
}
