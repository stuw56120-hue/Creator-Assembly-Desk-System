/*
 * Top-level app routing + project context.
 *
 * Phases: loading → (setup | ingest) → import → source → onboarding → proxy → editor.
 *  - setup      : one-time Projects + Asset Library folder pickers
 *  - ingest     : New Project — drag in MP4/VTT, transcribe, produce submission
 *  - import     : paste/file the customGPT JSON
 *  - source     : Step 1 — confirm or locate the source video file
 *  - onboarding : Step 2 — player image onboarding (skipped only when no images needed)
 *  - proxy      : generate the playback proxy before the editor opens
 *  - editor     : the timeline editor
 */

import { create } from "zustand";

export type AppPhase =
  | "loading"
  | "setup"
  | "ingest"
  | "import"
  | "source"
  | "onboarding"
  | "proxy"
  | "editor";

export interface IngestProject {
  projectName: string;
  projectDir: string;
  submissionDir: string;
  transcriptPath: string;
  audioPath: string;
  sourceVideoPath: string;
}

interface AppState {
  phase: AppPhase;
  projectsFolder: string;
  assetLibraryFolder: string;
  project: IngestProject | null;
  /** Transcript text uploaded on the Import screen, applied after the edit list loads. */
  pendingTranscript: string | null;
  /** The generated playback proxy for the current project (set by the proxy step). */
  proxyPath: string | null;

  setPhase: (phase: AppPhase) => void;
  setFolders: (folders: { projectsFolder?: string; assetLibraryFolder?: string }) => void;
  setProject: (project: IngestProject) => void;
  setPendingTranscript: (text: string | null) => void;
  setProxyPath: (path: string | null) => void;
  init: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  phase: "loading",
  projectsFolder: "",
  assetLibraryFolder: "",
  project: null,
  pendingTranscript: null,
  proxyPath: null,

  setPhase: (phase) => set({ phase }),
  setFolders: ({ projectsFolder, assetLibraryFolder }) =>
    set((s) => ({
      projectsFolder: projectsFolder ?? s.projectsFolder,
      assetLibraryFolder: assetLibraryFolder ?? s.assetLibraryFolder,
    })),
  setProject: (project) => set({ project }),
  setPendingTranscript: (pendingTranscript) => set({ pendingTranscript }),
  setProxyPath: (proxyPath) => set({ proxyPath }),

  init: async () => {
    const settings = (await window.cads?.settings?.get?.()) ?? {};
    const ready = Boolean(settings.projectsFolder && settings.assetLibraryFolder);
    set({
      projectsFolder: settings.projectsFolder ?? "",
      assetLibraryFolder: settings.assetLibraryFolder ?? "",
      phase: ready ? "ingest" : "setup",
    });
  },
}));
