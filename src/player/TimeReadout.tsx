/*
 * Current-time / duration readout. Subscribes to liveTime and writes directly
 * to the DOM via a ref — never triggers a React re-render during playback.
 */

import { useEffect, useRef } from "react";
import { usePlayerStore } from "./playerStore";
import { subscribeLiveTime } from "./usePlayback";
import { formatTime } from "./time";

export function TimeReadout() {
  const spanRef = useRef<HTMLSpanElement>(null);
  const duration = usePlayerStore((s) => s.duration);
  const startTime = usePlayerStore((s) => s.currentTime);

  useEffect(() => {
    if (spanRef.current) spanRef.current.textContent = formatTime(startTime);
    const unsubscribe = subscribeLiveTime((t) => {
      if (spanRef.current) spanRef.current.textContent = formatTime(t);
    });
    return () => {
      unsubscribe();
    };
  }, [startTime]);

  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-caption)" }}>
      <span ref={spanRef}>{formatTime(startTime)}</span>
      <span style={{ color: "var(--text-tertiary)" }}> / {formatTime(duration)}</span>
    </span>
  );
}
