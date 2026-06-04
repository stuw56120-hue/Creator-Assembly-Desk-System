/*
 * C.A.D.S. playback controller + hook.
 *
 * A module-level controller drives a requestAnimationFrame loop that advances a
 * virtual clock and publishes the time via liveTime.notify() — WITHOUT touching
 * React state, so the playhead and time readout update with zero per-frame
 * re-renders (mandatory per spec). currentTime is committed to the store only
 * on pause/seek. A bound <video> (the proxy) is slaved to the virtual clock, so
 * playback also works in dev before a proxy exists.
 */

import { useEffect } from "react";
import { liveTime, usePlayerStore } from "./playerStore";
import { useProjectStore } from "../project/projectStore";

interface KeepSegment {
  start: number;
  end: number;
}

interface PlaybackConfig {
  duration: number;
  playbackRate: number;
  loopEnabled: boolean;
  inPoint: number | null;
  outPoint: number | null;
  /** Kept (retained) source ranges. Playback skips the gaps between them (cuts). */
  keepSegments: KeepSegment[];
}

class PlaybackController {
  private time = 0;
  private raf = 0;
  private lastTs = 0;
  private playing = false;
  private video: HTMLVideoElement | null = null;
  private config: PlaybackConfig = {
    duration: 0,
    playbackRate: 1,
    loopEnabled: false,
    inPoint: null,
    outPoint: null,
    keepSegments: [],
  };

  configure(config: PlaybackConfig) {
    // Keep segments sorted so the gap-skipping scan below is a simple forward walk.
    this.config = {
      ...config,
      keepSegments: [...config.keepSegments].sort((a, b) => a.start - b.start),
    };
  }

  /**
   * Map a raw time to where playback should actually be: if it has fallen into a
   * cut (a gap between kept segments) jump to the next kept segment's start;
   * Infinity means it ran past the last kept content. With no keep segments
   * (nothing trimmed), time passes through unchanged.
   */
  private skipCuts(t: number): number {
    const segs = this.config.keepSegments;
    if (segs.length === 0) return t;
    for (const seg of segs) {
      if (t < seg.start) return seg.start; // in a gap → jump to next kept segment
      if (t <= seg.end) return t; // inside kept content
    }
    return Number.POSITIVE_INFINITY; // past the last kept segment
  }

  bindVideo(video: HTMLVideoElement | null) {
    this.video = video;
  }

  getTime() {
    return this.time;
  }

  private lowerBound() {
    return this.config.inPoint ?? 0;
  }

  private upperBound() {
    return this.config.outPoint ?? this.config.duration;
  }

  private commit() {
    usePlayerStore.getState().setCurrentTime(this.time);
  }

  /**
   * Slave the bound <video> to the virtual clock. During smooth playback the
   * video advances on its OWN decode clock, so we only re-seek it on a real
   * discontinuity (play start, manual seek, cut-skip → `force`) or a large
   * desync. Force-seeking for the small transient drift that builds while the
   * proxy is still buffering just fights the video's buffering and can wedge it
   * in a permanent re-buffer loop (the playhead keeps moving, so each seek
   * targets a position the video never reaches).
   */
  private syncVideo(force = false) {
    if (!this.video) return;
    const drift = Math.abs(this.video.currentTime - this.time);
    if (force || drift > 0.34) {
      this.video.currentTime = this.time;
    }
  }

  private frame = (ts: number) => {
    const dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    const rawT = this.time + dt * Math.max(0.1, this.config.playbackRate);

    // Jump over any cut the playhead has entered, so kept content plays back to
    // back. A cut-skip is a discontinuity → force the bound <video> to follow.
    let t = this.skipCuts(rawT);
    let jumped = Number.isFinite(t) && Math.abs(t - rawT) > 0.001;

    const end = this.upperBound();
    if (t >= end || !Number.isFinite(t)) {
      if (this.config.loopEnabled) {
        t = this.skipCuts(this.lowerBound());
        if (!Number.isFinite(t)) t = this.lowerBound();
        jumped = true; // looped back to the start — a discontinuity
      } else {
        const stopAt = Number.isFinite(t) ? Math.min(t, end) : end;
        this.time = stopAt;
        liveTime.notify(stopAt);
        this.pause();
        return;
      }
    }
    this.time = t;
    liveTime.notify(t);
    this.syncVideo(jumped);
    if (this.playing) this.raf = requestAnimationFrame(this.frame);
  };

  play() {
    if (this.playing) return;
    if (this.time >= this.upperBound()) this.time = this.lowerBound();
    // If play starts inside a cut, snap forward to the next kept content.
    const snapped = this.skipCuts(this.time);
    if (Number.isFinite(snapped)) {
      this.time = snapped;
      liveTime.notify(snapped);
      this.syncVideo(true);
    }
    this.playing = true;
    usePlayerStore.getState().setIsPlaying(true);
    this.video?.play().catch(() => {
      /* proxy may be absent in dev — virtual clock still drives playback */
    });
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.video?.pause();
    usePlayerStore.getState().setIsPlaying(false);
    this.commit();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t: number) {
    const clamped = Math.max(0, Math.min(t, this.config.duration || t));
    this.time = clamped;
    liveTime.notify(clamped);
    this.syncVideo(true);
    this.commit();
  }
}

export const playbackController = new PlaybackController();

/** Sync store-driven playback config into the controller; expose controls. */
export function usePlayback() {
  const duration = usePlayerStore((s) => s.duration);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const loopEnabled = usePlayerStore((s) => s.loopEnabled);
  const inPoint = usePlayerStore((s) => s.inPoint);
  const outPoint = usePlayerStore((s) => s.outPoint);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const keepSegments = useProjectStore((s) => s.keepSegments);

  useEffect(() => {
    playbackController.configure({
      duration,
      playbackRate,
      loopEnabled,
      inPoint,
      outPoint,
      keepSegments,
    });
  }, [duration, playbackRate, loopEnabled, inPoint, outPoint, keepSegments]);

  return {
    isPlaying,
    play: () => playbackController.play(),
    pause: () => playbackController.pause(),
    toggle: () => playbackController.toggle(),
    seek: (t: number) => playbackController.seek(t),
  };
}

/** Subscribe to the live playback time without re-rendering on every frame. */
export function subscribeLiveTime(cb: (t: number) => void): () => boolean {
  return liveTime.subscribe(cb);
}
