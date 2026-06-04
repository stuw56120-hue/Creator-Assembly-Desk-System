/*
 * Drives the motion graphic build queue produced by the edit list parser.
 *
 * On import (Step 3 of the UX) C.A.D.S. builds every motion graphic the
 * customGPT specified before the timeline opens, showing a per-item Build
 * Progress screen. This runner executes the queue sequentially, reports
 * progress, and captures per-job failures without aborting the rest.
 *
 * The `build` function is injected (window.cads.motionGraphics.build in the
 * app) so this stays UI- and IPC-agnostic and testable.
 */

import type { MotionGraphicBuildJob } from "../project/editListParser";

export interface QueuedBuildOutcome {
  mgId: string;
  templateId: string;
  ok: boolean;
  assetPath?: string;
  error?: string;
}

export interface BuildQueueProgress {
  done: number;
  total: number;
  job: MotionGraphicBuildJob;
  outcome: QueuedBuildOutcome;
}

export async function runMotionGraphicBuildQueue(
  queue: MotionGraphicBuildJob[],
  build: (job: MotionGraphicBuildJob) => Promise<{ assetPath: string }>,
  onProgress?: (progress: BuildQueueProgress) => void,
): Promise<QueuedBuildOutcome[]> {
  const outcomes: QueuedBuildOutcome[] = [];
  let done = 0;

  for (const job of queue) {
    let outcome: QueuedBuildOutcome;
    try {
      const result = await build(job);
      outcome = { mgId: job.mgId, templateId: job.templateId, ok: true, assetPath: result.assetPath };
    } catch (err) {
      outcome = {
        mgId: job.mgId,
        templateId: job.templateId,
        ok: false,
        error: (err as Error).message,
      };
    }
    outcomes.push(outcome);
    done += 1;
    onProgress?.({ done, total: queue.length, job, outcome });
  }

  return outcomes;
}
