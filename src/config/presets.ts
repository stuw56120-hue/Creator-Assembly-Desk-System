/*
 * Typed access to the config/ preset files. Single source of truth for ingest
 * defaults, FFmpeg encode presets, and motion-graphic defaults/min-durations.
 */

import pipelineDefaults from "../../config/pipeline_defaults.json";
import ffmpegPresets from "../../config/ffmpeg_presets.json";
import motionGraphicRegistry from "../../config/motion_graphic_registry.json";

export interface PipelineDefaults {
  ingest: {
    whisper_model: string;
    language: string;
    audio_sample_rate: number;
    audio_channels: number;
    silence_threshold_db: number;
    min_silence_seconds: number;
  };
  render: {
    longform_preset: string;
    short_preset: string;
    proxy_preset: string;
  };
}

export interface FfmpegPreset {
  videoCodec: string;
  pixelFormat?: string;
  audioCodec: string;
  preset?: string;
  crf?: number;
  width?: number;
  height?: number;
  scaleHeight?: number;
}

export interface MotionGraphicConfig {
  defaults: { fps: number; backdropColour: string };
  minimumDurationSeconds: Record<string, number>;
  defaultPlacement: Record<string, string>;
}

export function getPipelineDefaults(): PipelineDefaults {
  return pipelineDefaults as PipelineDefaults;
}

export function getFfmpegPreset(name: "longform" | "short" | "proxy"): FfmpegPreset {
  return (ffmpegPresets as Record<string, FfmpegPreset>)[name];
}

export function getMotionGraphicConfig(): MotionGraphicConfig {
  return motionGraphicRegistry as MotionGraphicConfig;
}

/** Minimum readable duration for a template (0 when unspecified). */
export function minimumDurationFor(templateId: string): number {
  return getMotionGraphicConfig().minimumDurationSeconds[templateId] ?? 0;
}
