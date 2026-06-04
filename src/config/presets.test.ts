import { describe, expect, it } from "vitest";
import {
  getFfmpegPreset,
  getMotionGraphicConfig,
  getPipelineDefaults,
  minimumDurationFor,
} from "./presets";

describe("config presets", () => {
  it("exposes ingest + render defaults", () => {
    const d = getPipelineDefaults();
    expect(d.ingest.whisper_model).toBe("base");
    expect(d.ingest.language).toBe("en");
    expect(d.ingest.audio_sample_rate).toBe(16000);
    expect(d.render.longform_preset).toBe("longform");
  });

  it("exposes ffmpeg encode presets", () => {
    expect(getFfmpegPreset("longform")).toMatchObject({ videoCodec: "libx264", audioCodec: "aac" });
    expect(getFfmpegPreset("short")).toMatchObject({ width: 1080, height: 1920 });
    expect(getFfmpegPreset("proxy").preset).toBe("veryfast");
  });

  it("exposes motion-graphic defaults and minimum durations", () => {
    const mg = getMotionGraphicConfig();
    expect(mg.defaults.fps).toBe(30);
    expect(mg.defaultPlacement.subscribe_flash).toBe("lower_right");
    expect(minimumDurationFor("quote_card")).toBe(2.5);
    expect(minimumDurationFor("unknown_template")).toBe(0);
  });
});
