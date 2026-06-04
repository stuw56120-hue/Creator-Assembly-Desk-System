import { describe, expect, it, vi } from "vitest";
import { runMotionGraphicBuildQueue } from "./buildQueueRunner";
import { parseEditList } from "../project/editListParser";
import { getTemplateRegistry } from "./templateRegistry";
import sweetRelief from "../project/__fixtures__/sweet-relief.json";

function queueFromFixture() {
  const result = parseEditList(sweetRelief, getTemplateRegistry());
  if (!result.ok) throw new Error("fixture should parse");
  return result.buildQueue;
}

describe("runMotionGraphicBuildQueue", () => {
  it("builds every job in the queue and reports progress in order", async () => {
    const queue = queueFromFixture();
    expect(queue).toHaveLength(2);

    const progress: number[] = [];
    const build = vi.fn(async (job) => ({ assetPath: `/lib/${job.mgId}.webm` }));

    const outcomes = await runMotionGraphicBuildQueue(queue, build, (p) => progress.push(p.done));

    expect(build).toHaveBeenCalledTimes(2);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(outcomes.map((o) => o.assetPath)).toEqual(["/lib/overlay_001.webm", "/lib/overlay_002.webm"]);
    expect(progress).toEqual([1, 2]); // progress fired once per job, in order
  });

  it("captures a per-job failure without aborting the rest of the queue", async () => {
    const queue = queueFromFixture();
    const build = vi.fn(async (job) => {
      if (job.mgId === "overlay_001") throw new Error("hyperframes exploded");
      return { assetPath: `/lib/${job.mgId}.webm` };
    });

    const outcomes = await runMotionGraphicBuildQueue(queue, build);

    expect(build).toHaveBeenCalledTimes(2); // continued past the failure
    expect(outcomes[0]).toMatchObject({ mgId: "overlay_001", ok: false, error: "hyperframes exploded" });
    expect(outcomes[1]).toMatchObject({ mgId: "overlay_002", ok: true });
  });
});
