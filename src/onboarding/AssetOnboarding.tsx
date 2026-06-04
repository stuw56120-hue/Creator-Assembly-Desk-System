/*
 * Asset Onboarding screen. Shown between JSON import and the timeline whenever
 * the customGPT requires images. Composes one row per required asset, the
 * model-download banner, summary counts, and the Skip-optional / Continue
 * actions. `allRequiredDone` is the only gate — optional assets never block.
 */

import { useEffect, useState } from "react";
import { ModelDownloadBanner } from "./ModelDownloadBanner";
import { AssetOnboardingRow } from "./AssetOnboardingRow";
import { useOnboardingStore } from "./onboardingStore";
import { useProjectStore } from "../project/projectStore";
import { humanizeSubject } from "../project/displayNames";
import type { RequiredAsset } from "../project/editListParser";

interface OnboardGroup {
  key: string;
  subject: string | null;
  assets: RequiredAsset[];
}

/** Group required assets by image_subject (players), preserving first-seen order. */
function groupBySubject(assets: RequiredAsset[]): OnboardGroup[] {
  const byKey = new Map<string, OnboardGroup>();
  const order: string[] = [];
  for (const asset of assets) {
    const key = asset.image_subject ? `subj:${asset.image_subject}` : "__ungrouped__";
    let group = byKey.get(key);
    if (!group) {
      group = { key, subject: asset.image_subject ?? null, assets: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.assets.push(asset);
  }
  return order.map((k) => byKey.get(k)!);
}

export function AssetOnboarding({ onContinue }: { onContinue?: () => void }) {
  const requiredAssets = useOnboardingStore((s) => s.requiredAssets);
  const rows = useOnboardingStore((s) => s.rows);
  const allRequiredDone = useOnboardingStore((s) => s.allRequiredDone);

  const statuses = requiredAssets.map((a) => rows[a.asset_id]?.status ?? "pending");
  const doneCount = statuses.filter((s) => s === "done").length;
  const processingCount = statuses.filter((s) => s === "processing" || s === "uploading").length;
  const optionalPending = requiredAssets.filter(
    (a) => a.optional && rows[a.asset_id]?.status !== "done",
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "var(--space-sm) var(--space-lg)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <strong style={{ letterSpacing: 2 }}>C.A.D.S.</strong>
        <span style={{ color: "var(--text-tertiary)" }}>{useOnboardingTitle()}</span>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-2xl) var(--space-2xl) 0", maxWidth: 820, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <h2 style={{ marginBottom: "var(--space-sm)" }}>Review the players for this edit.</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)" }}>
          The customGPT identified {requiredAssets.length} image
          {requiredAssets.length === 1 ? "" : "s"} for this video. Players already in your Asset
          Library are filled in below — upload any that are missing, and check each player's
          display name (the name that appears in banners, chapters, and captions). New uploads are
          processed automatically into three variants (original, background removed, and bokeh).
        </p>

        <ModelDownloadBanner />

        {/* Player image groups first (one block per image_subject), then any
            ungrouped required assets. */}
        {groupBySubject(requiredAssets).map((group) => (
          <div key={group.key} style={{ marginBottom: "var(--space-lg)" }}>
            {group.subject && (
              <PlayerNameHeading
                subject={group.subject}
                groupAssetIds={group.assets.map((a) => a.asset_id)}
                imageCount={group.assets.length}
              />
            )}
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                background: "var(--surface)",
                overflow: "hidden",
              }}
            >
              {group.assets.map((asset) => (
                <AssetOnboardingRow key={asset.asset_id} asset={asset} />
              ))}
            </div>
          </div>
        ))}

        <div
          style={{
            display: "flex",
            gap: "var(--space-lg)",
            margin: "var(--space-lg) 0",
            fontSize: "var(--font-size-caption)",
            color: "var(--text-secondary)",
          }}
        >
          <span>✓ {doneCount} of {requiredAssets.length} ready</span>
          {processingCount > 0 && <span>⟳ {processingCount} processing</span>}
          {optionalPending > 0 && <span>○ {optionalPending} optional / skippable</span>}
        </div>
      </div>

      <footer
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--space-sm)",
          padding: "var(--space-md) var(--space-lg)",
          borderTop: "1px solid var(--border)",
        }}
      >
        {optionalPending > 0 && (
          <button
            type="button"
            onClick={() => useOnboardingStore.getState().skipOptional()}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            Skip optional
          </button>
        )}
        <button
          type="button"
          disabled={!allRequiredDone}
          onClick={() => onContinue?.()}
          className="btn-primary"
          style={{
            background: allRequiredDone ? "var(--accent-green)" : "var(--surface2)",
            color: allRequiredDone ? "#0a0a0a" : "var(--text-tertiary)",
          }}
        >
          Continue to edit →
        </button>
      </footer>
    </div>
  );
}

/**
 * Editable display-name field beside a player group heading. The image_subject
 * slug stays the internal id; this name is what shows up in banners, chapters,
 * motion graphics, and captions. Commits on blur / Enter — updating the project
 * (which rewrites every reference) and persisting to the library.
 */
/** "mathys-tel-action" → "mathys-tel" — the player slug portion of a suggested filename. */
function subjectSlugFromFilename(sf: string | undefined): string | undefined {
  if (!sf) return undefined;
  const parts = sf.split("-");
  return parts.length > 1 ? parts.slice(0, -1).join("-") : sf;
}

function PlayerNameHeading({
  subject,
  groupAssetIds,
  imageCount,
}: {
  subject: string;
  groupAssetIds: string[];
  imageCount: number;
}) {
  const stored = useProjectStore((s) => s.playerDisplayNames[subject]);
  const committed = stored ?? humanizeSubject(subject);
  const [value, setValue] = useState(committed);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // The slug shown in the chip should reflect what's actually on the NAS —
  // hydrate writes the matched library group's suggested_filename into
  // libraryMatches; we extract the player portion (drop the trailing -<role>)
  // and fall back to the JSON's image_subject when nothing is matched yet.
  const libraryMatches = useOnboardingStore((s) => s.libraryMatches);
  const matchedFilename = groupAssetIds
    .map((id) => libraryMatches[id]?.suggestedFilename)
    .find(Boolean);
  const librarySubjectSlug = subjectSlugFromFilename(matchedFilename);
  const displaySlug = librarySubjectSlug ? librarySubjectSlug.replace(/-/g, "_") : subject;

  // Keep in sync if the seeded/persisted name arrives or changes elsewhere.
  useEffect(() => {
    if (stored !== undefined) setValue(stored);
  }, [stored]);

  const trimmed = value.trim();
  const dirty = trimmed !== "" && trimmed !== committed;

  async function save() {
    if (!dirty) return;
    setSaveState("saving");
    // Update every in-app reference (labels, MG text, captions) immediately…
    useProjectStore.getState().setPlayerDisplayName(subject, trimmed);
    try {
      // …and persist to library_index.json so it survives a restart.
      await window.cads?.assets?.setPlayerName({ imageSubject: subject, displayName: trimmed });
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)", marginBottom: "var(--space-xs)" }}>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (saveState !== "idle") setSaveState("idle");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        aria-label={`Display name for ${subject}`}
        title={librarySubjectSlug ? `On disk: ${librarySubjectSlug}\nJSON: ${subject}` : `JSON: ${subject}`}
        style={{
          fontSize: "var(--font-size-h3, 1.17em)",
          fontWeight: 700,
          background: "transparent",
          color: "var(--text)",
          border: "1px solid transparent",
          borderBottom: "1px dashed var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "2px 4px",
        }}
      />
      {dirty && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saveState === "saving"}
          className="btn-primary"
          style={{ fontSize: "var(--font-size-caption)", padding: "2px 12px" }}
        >
          {saveState === "saving" ? "Saving…" : "Save name"}
        </button>
      )}
      {saveState === "saved" && (
        <span style={{ color: "var(--accent-green)", fontSize: "var(--font-size-caption)" }}>✓ Saved</span>
      )}
      {saveState === "error" && (
        <span style={{ color: "#ff6b6b", fontSize: "var(--font-size-caption)" }}>
          Couldn’t save — try again
        </span>
      )}
      <span style={{ color: "var(--text-tertiary)", fontWeight: 400, fontSize: "var(--font-size-caption)" }}>
        {displaySlug} · {imageCount} image{imageCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function useOnboardingTitle(): string {
  // Project name lives in projectStore; kept light here to avoid a hard dep.
  return "Asset Onboarding";
}
