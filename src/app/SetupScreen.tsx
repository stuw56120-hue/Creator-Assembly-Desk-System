/*
 * One-time setup. Point C.A.D.S. at a Projects folder and an Asset Library
 * folder; both are remembered permanently (cads-settings.json).
 */

import { useAppStore } from "./appStore";

function FolderRow({
  label,
  hint,
  value,
  onPick,
}: {
  label: string;
  hint: string;
  value: string;
  onPick: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-md)",
        marginBottom: "var(--space-md)",
        background: "var(--surface)",
      }}
    >
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)", marginBottom: "var(--space-sm)" }}>
        {hint}
      </div>
      <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
        <button type="button" className="btn-primary" onClick={onPick}>
          {value ? "Change…" : "Choose folder…"}
        </button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-caption)", color: "var(--text-secondary)", wordBreak: "break-all" }}>
          {value || "Not set"}
        </span>
      </div>
    </div>
  );
}

export function SetupScreen() {
  const projectsFolder = useAppStore((s) => s.projectsFolder);
  const assetLibraryFolder = useAppStore((s) => s.assetLibraryFolder);
  const setFolders = useAppStore((s) => s.setFolders);
  const setPhase = useAppStore((s) => s.setPhase);

  async function pick(kind: "projectsFolder" | "assetLibraryFolder", title: string) {
    const folder = await window.cads.dialog.pickFolder({ title });
    if (!folder) return;
    await window.cads.settings.set({ [kind]: folder });
    setFolders({ [kind]: folder });
  }

  const ready = Boolean(projectsFolder && assetLibraryFolder);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-2xl) var(--space-lg)" }}>
      <h1 style={{ fontSize: 40, letterSpacing: 4 }}>C.A.D.S.</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-xl)" }}>
        Before you begin, tell C.A.D.S. where to keep your work. You only do this once.
      </p>

      <FolderRow
        label="Your Projects folder"
        hint="Where all project files (sources, transcripts, renders) are saved."
        value={projectsFolder}
        onPick={() => pick("projectsFolder", "Choose your Projects folder")}
      />
      <FolderRow
        label="Your Asset Library folder"
        hint="Where your images, memes, and motion graphics live."
        value={assetLibraryFolder}
        onPick={() => pick("assetLibraryFolder", "Choose your Asset Library folder")}
      />

      <button
        type="button"
        className="btn-primary"
        disabled={!ready}
        onClick={() => setPhase("ingest")}
        style={{
          marginTop: "var(--space-md)",
          background: ready ? "var(--accent-green)" : "var(--surface2)",
          color: ready ? "#0a0a0a" : "var(--text-tertiary)",
        }}
      >
        Continue →
      </button>
    </div>
  );
}
