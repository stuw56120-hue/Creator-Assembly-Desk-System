/*
 * Caption Editor — fix Whisper transcription errors before render.
 *
 * Lists every caption segment as an editable row (timestamp · speaker · text).
 * Inline edits commit on blur; Split breaks a caption at the cursor; Merge ↓
 * joins it with the next; Delete removes it; captions over 7 words are flagged
 * red. All operations are normal store mutations, so the timeline updates live
 * and everything is undoable. "Upload transcript" replaces the whole track.
 */

import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../project/projectStore";
import { applyTranscriptCaptions } from "../project/loadProject";
import { EXCESS_WORDS, countWords } from "../project/captions";
import { formatTimecode } from "../project/timecode";
import { playbackController, subscribeLiveTime } from "../player/usePlayback";
import type { TimelineEvent } from "../project/types";

/** Caption whose [start, start+duration) covers `t`, else nearest by start time. */
function activeOrNearestCaption(
  captions: TimelineEvent[],
  t: number,
): TimelineEvent | null {
  if (captions.length === 0) return null;
  for (const c of captions) {
    if (t >= c.start && t < c.start + Math.max(c.duration, 0.0001)) return c;
  }
  let best = captions[0];
  let bestDist = Math.abs(best.start - t);
  for (const c of captions) {
    const d = Math.abs(c.start - t);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function CaptionEditor({ onClose }: { onClose: () => void }) {
  const captions = useProjectStore((s) =>
    s.events.filter((e) => e.kind === "caption").sort((a, b) => a.start - b.start),
  );
  const captionStyle = useProjectStore((s) => s.captionStyle);
  const setCaptionStyle = useProjectStore((s) => s.setCaptionStyle);
  const [uploadMsg, setUploadMsg] = useState("");

  // The row to scroll the list to on open — the caption active at the playhead,
  // or the nearest one. Captured ONCE so the user can scroll away afterwards.
  const [initialScrollId] = useState<string | null>(
    () => activeOrNearestCaption(captions, playbackController.getTime())?.id ?? null,
  );
  // The row currently being "spoken" by the playhead — updates with playback so
  // the highlight follows along even after the user has scrolled.
  const [activeNowId, setActiveNowId] = useState<string | null>(initialScrollId);
  useEffect(() => {
    const compute = (t: number) => {
      const found = captions.find(
        (c) => t >= c.start && t < c.start + Math.max(c.duration, 0.0001),
      );
      const id = found?.id ?? null;
      setActiveNowId((prev) => (prev === id ? prev : id));
    };
    compute(playbackController.getTime());
    const unsub = subscribeLiveTime(compute);
    return () => {
      unsub();
    };
  }, [captions]);
  // Scroll-into-view runs ONCE on mount once the row has rendered.
  useEffect(() => {
    if (!initialScrollId) return;
    const el = document.querySelector<HTMLElement>(`[data-caption-id="${initialScrollId}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }, [initialScrollId]);

  const overLimit = captions.filter((c) => countWords(c.captionData?.text ?? "") > EXCESS_WORDS).length;

  async function uploadTranscript() {
    const file = await window.cads.dialog.pickFile({
      title: "Upload improved transcript",
      filters: [{ name: "Transcript", extensions: ["txt", "vtt", "srt"] }],
    });
    if (!file) return;
    try {
      const count = applyTranscriptCaptions(await window.cads.project.readText(file));
      setUploadMsg(count > 0 ? `Loaded ${count} captions.` : "No captions found in that file.");
    } catch {
      setUploadMsg("Couldn't read that transcript file.");
    }
  }

  return (
    <div
      data-cads-no-shortcuts="caption-editor"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(820px, 94vw)",
          height: "min(80vh, 760px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "var(--space-sm) var(--space-md)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-md)" }}>
            <strong>Caption Editor</strong>
            <span style={{ fontSize: "var(--font-size-caption)", color: "var(--text-tertiary)" }}>
              {captions.length} segment{captions.length === 1 ? "" : "s"}
              {overLimit > 0 ? ` · ${overLimit} over ${EXCESS_WORDS} words` : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
            {uploadMsg && (
              <span style={{ fontSize: "var(--font-size-caption)", color: "var(--accent-green)" }}>
                {uploadMsg}
              </span>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>
              Style
              <select
                value={captionStyle}
                onChange={(e) => setCaptionStyle(e.target.value)}
                style={{ ...btn, padding: "0.3rem 0.5rem" }}
              >
                <option value="clean_podcast">Clean podcast</option>
                <option value="bold_social">Bold social</option>
                <option value="quote_emphasis">Quote emphasis</option>
                <option value="karaoke_highlight">Karaoke highlight</option>
              </select>
            </label>
            <button type="button" onClick={uploadTranscript} style={btn}>
              Upload transcript
            </button>
            <button type="button" onClick={onClose} style={{ cursor: "pointer" }}>
              ✕
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm)" }}>
          {captions.length === 0 ? (
            <p style={{ color: "var(--text-tertiary)", padding: "var(--space-lg)", textAlign: "center" }}>
              No captions yet. Click <strong>Upload transcript</strong> to load the Whisper output
              (or a corrected version) as an editable caption track.
            </p>
          ) : (
            captions.map((caption, i) => (
              <CaptionRow
                key={caption.id}
                caption={caption}
                index={i}
                nextId={captions[i + 1]?.id}
                isActive={caption.id === activeNowId}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CaptionRow({
  caption,
  index,
  nextId,
  isActive,
}: {
  caption: TimelineEvent;
  index: number;
  nextId?: string;
  isActive: boolean;
}) {
  const [speaker, setSpeaker] = useState(caption.captionData?.speaker ?? "");
  const [text, setText] = useState(caption.captionData?.text ?? caption.label);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number>(text.length);

  const words = countWords(text);
  const tooLong = words > EXCESS_WORDS;

  function commit() {
    const orig = caption.captionData;
    if (orig && speaker === orig.speaker && text === orig.text) return;
    useProjectStore.getState().updateEvent(caption.id, {
      label: text,
      captionData: { speaker, text },
    });
  }

  function split() {
    commit(); // persist the current text first, so the split uses it
    useProjectStore.getState().splitCaption(caption.id, caretRef.current ?? text.length);
  }

  return (
    <div
      data-caption-id={caption.id}
      style={{
        display: "grid",
        gridTemplateColumns: "64px 130px 1fr auto",
        gap: "var(--space-sm)",
        alignItems: "start",
        padding: "var(--space-sm)",
        borderBottom: "1px solid var(--border)",
        background: isActive ? "rgba(74,158,255,0.16)" : undefined,
        borderLeft: isActive ? "3px solid var(--accent-blue, #4a9eff)" : "3px solid transparent",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-tertiary)",
          paddingTop: 6,
        }}
      >
        {formatTimecode(caption.start)}
      </span>

      <input
        type="text"
        value={speaker}
        placeholder="Speaker"
        onChange={(e) => setSpeaker(e.target.value)}
        onBlur={commit}
        style={inputStyle}
      />

      <div>
        <textarea
          ref={textRef}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onSelect={(e) => (caretRef.current = e.currentTarget.selectionStart)}
          style={{
            ...inputStyle,
            width: "100%",
            resize: "vertical",
            borderColor: tooLong ? "#ff6b6b" : "var(--border)",
          }}
        />
        <span style={{ fontSize: 10, color: tooLong ? "#ff6b6b" : "var(--text-tertiary)" }}>
          {words} word{words === 1 ? "" : "s"}
          {tooLong ? ` — over ${EXCESS_WORDS}, consider splitting` : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button type="button" onClick={split} style={miniBtn} title="Split at cursor">
          Split
        </button>
        <button
          type="button"
          onClick={() => nextId && useProjectStore.getState().mergeCaptions(caption.id, nextId)}
          disabled={!nextId}
          style={miniBtn}
          title="Merge with next"
        >
          Merge ↓
        </button>
        <button
          type="button"
          onClick={() => useProjectStore.getState().removeEvent(caption.id)}
          style={{ ...miniBtn, color: "#ff6b6b" }}
          title="Delete caption"
        >
          Delete
        </button>
      </div>
      <span style={{ display: "none" }}>{index}</span>
    </div>
  );
}

const btn: React.CSSProperties = {
  fontSize: 13,
  padding: "0.4rem 1rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text)",
  padding: "var(--space-xs) var(--space-sm)",
  font: "inherit",
  fontSize: "var(--font-size-caption)",
  boxSizing: "border-box",
};

const miniBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
