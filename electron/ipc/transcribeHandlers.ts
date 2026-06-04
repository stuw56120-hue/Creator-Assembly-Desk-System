/*
 * Electron IPC — Whisper transcription bridge. Spawns transcribe_worker.py
 * (faster-whisper, local) and surfaces its progress. Used standalone via
 * "transcribe:run" and by the ingest orchestration (projectHandlers).
 */

import { ipcMain, app, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { spawnStreaming, PYTHON_WORKER_ENV } from "./spawnUtil";
import { transcribeArgs } from "../../src/project/ingestPlan";

const PYTHON_BIN = process.env.CADS_PYTHON_BIN ?? "python";

export interface TranscribeResult {
  transcript_path: string;
  language: string;
  duration: number;
  segment_count: number;
}

export async function runTranscribe(
  audioPath: string,
  transcriptPath: string,
  model: string,
  language: string,
  onProgress: (stage: string, percent: number) => void,
): Promise<TranscribeResult> {
  const script = path.join(app.getAppPath(), "workers", "transcribe_worker.py");
  const args = [script, ...transcribeArgs(audioPath, transcriptPath, model, language)];
  const { stdout } = await spawnStreaming(
    PYTHON_BIN,
    args,
    (line) => {
      const m = /^PROGRESS (.+) (\d+)$/.exec(line);
      if (m) onProgress(m[1], Number(m[2]));
    },
    { env: PYTHON_WORKER_ENV },
  );
  return JSON.parse(stdout.trim()) as TranscribeResult;
}

export function registerTranscribeHandlers(): void {
  ipcMain.handle(
    "transcribe:run",
    async (
      event: IpcMainInvokeEvent,
      args: { audioPath: string; transcriptPath: string; model: string; language: string },
    ) =>
      runTranscribe(args.audioPath, args.transcriptPath, args.model, args.language, (stage, percent) =>
        event.sender.send("ingest:log", { line: `${stage}… ${percent}%`, percent }),
      ),
  );
}
