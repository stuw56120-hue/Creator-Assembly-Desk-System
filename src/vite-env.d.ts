/// <reference types="vite/client" />

// Surface of the preload context bridge. Expanded as IPC channels are added.
interface MotionGraphicBuildResult {
  assetId: string;
  assetPath: string;
  thumbnailPath?: string;
  durationSeconds: number;
}

interface MotionGraphicBuildArgs {
  assetId: string;
  templateId: string;
  params: Record<string, unknown>;
  /** Project folder for resolving project-scoped assets (e.g. background images). Optional for backwards compat. */
  projectFolder?: string;
}

interface IngestResult {
  projectName: string;
  projectDir: string;
  submissionDir: string;
  transcriptPath: string;
  audioPath: string;
  sourceVideoPath: string;
  version?: number;
  createdAt?: string;
}

interface MgBackgroundUploadResult {
  ok: true;
  id: string;
  originalFilename: string;
  ext: string;
  bytes: number;
  createdAt: string;
  absolutePath: string;
}

interface MgBackgroundUploadFailure {
  ok: false;
  error: string;
}

interface MgBackgroundIndexEntry {
  id: string;
  original_filename: string;
  ext: string;
  bytes: number;
  created_at: string;
}

interface CadsApi {
  getVersions: () => { electron: string; chrome: string; node: string };
  mgBackground: {
    upload: (args: {
      projectFolder: string;
      sourcePath: string;
    }) => Promise<MgBackgroundUploadResult | MgBackgroundUploadFailure>;
    list: (args: { projectFolder: string }) => Promise<MgBackgroundIndexEntry[]>;
  };
  motionGraphics: {
    build: (args: MotionGraphicBuildArgs) => Promise<MotionGraphicBuildResult>;
    rebuild: (args: MotionGraphicBuildArgs) => Promise<MotionGraphicBuildResult>;
    preview: (args: {
      templateId: string;
      params: Record<string, unknown>;
      projectFolder?: string;
    }) => Promise<{ previewPath: string; durationSeconds: number }>;
  };
  assets: {
    scan: () => Promise<{ assets: unknown[]; asset_groups: unknown[] }>;
    /** Remove index entries whose backing file no longer exists on disk. */
    clean: () => Promise<{ removed: number; removedIds: string[]; kept: number }>;
    setPlayerName: (args: {
      imageSubject: string;
      displayName: string;
    }) => Promise<{ ok: boolean }>;
  };
  motionGraphicsEngine: {
    ensureBrowser: () => Promise<
      | { state: "ready"; alreadyPresent: boolean }
      | { state: "error"; message: string }
    >;
    onProgress: (cb: (data: { line: string }) => void) => () => void;
  };
  log: {
    error: (message: string) => void;
    info: (message: string) => void;
  };
  settings: {
    get: () => Promise<{ projectsFolder?: string; assetLibraryFolder?: string }>;
    set: (patch: {
      projectsFolder?: string;
      assetLibraryFolder?: string;
    }) => Promise<{ projectsFolder?: string; assetLibraryFolder?: string }>;
  };
  dialog: {
    pickFolder: (args: { title?: string }) => Promise<string | null>;
    pickFile: (args: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<string | null>;
  };
  project: {
    openPath: (target: string) => Promise<string>;
    readText: (filePath: string) => Promise<string>;
    fileExists: (filePath: string) => Promise<boolean>;
    save: (args: { projectName: string; snapshot: unknown }) => Promise<{ path: string }>;
    open: (
      dir: string,
    ) => Promise<
      | { kind: "snapshot"; snapshot: unknown }
      | { kind: "ingest"; manifest: IngestResult }
      | { kind: "none" }
    >;
  };
  ingest: {
    run: (args: {
      projectName: string;
      videoPath: string;
      vttPath?: string;
      language: string;
      model: string;
    }) => Promise<IngestResult>;
    onLog: (cb: (data: { line: string; percent?: number }) => void) => () => void;
    /** The most recent completed ingest (settings.lastIngestDir), or null. */
    last: () => Promise<IngestResult | null>;
  };
  render: {
    longform: (plan: {
      sourcePath: string;
      keepSegments: { start: number; end: number }[];
      overlays: { inputPath: string; sourceStart: number; duration: number; placement: string; x?: number; y?: number; width?: number; fullFrame?: boolean; opacity?: number }[];
      transitions?: { sourceStart: number; type: string }[];
      captions?: { sourceStart: number; duration: number; text: string }[];
      captionStyle?: string;
      defaultName: string;
    }) => Promise<{ canceled: boolean; outputPath?: string }>;
    short: (
      plan:
        | {
            // v1 single-clip short
            sourcePath: string;
            inSeconds: number;
            outSeconds: number;
            overlays: { inputPath: string; sourceStart: number; duration: number; placement: string; x?: number; y?: number; width?: number; fullFrame?: boolean; opacity?: number }[];
            captions?: { sourceStart: number; duration: number; text: string }[];
            captionStyle?: string;
            defaultName: string;
          }
        | {
            // Shorts Schema v2 (segments[] present → assembled multi-segment path)
            sourcePath: string;
            segments: {
              inSeconds: number;
              outSeconds: number;
              energy?: string;
              transitionIn?: string;
              transitionOut?: string;
              overlays?: { inputPath: string; appearAtSeconds: number; durationSeconds: number }[];
              emphasis?: string[];
            }[];
            hookOverlay?: { inputPath: string; appearAtSeconds: number; durationSeconds: number };
            ctaOverlay?: { inputPath: string; appearAtSeconds: number; durationSeconds: number };
            vttPath?: string;
            captionWords?: { text: string; start: number; end: number }[];
            captionStyle?: string;
            quality?: "proxy" | "full";
            fadeInSeconds?: number;
            fadeOutSeconds?: number;
            zoomPunchOnCut?: boolean;
            defaultName: string;
          },
    ) => Promise<
      | { canceled: true }
      | { canceled: false; blocked: true; errors: string[] }
      | { canceled: false; blocked?: false; outputPath?: string; quality?: "proxy" | "full"; contactSheet?: string; coverage?: number }
    >;
    proxy: (args: {
      sourcePath: string;
      durationSeconds: number;
    }) => Promise<{ outputPath: string; cached?: boolean }>;
    onProgress: (cb: (data: { phase: string; percent: number }) => void) => () => void;
  };
  image: {
    checkModel: () => Promise<{ downloaded: boolean; sizeMb: number }>;
    downloadModel: () => Promise<{ downloaded: boolean }>;
    upload: (args: {
      filePath: string;
      assetId: string;
      suggestedFilename: string;
      imageSubject?: string;
    }) => Promise<{ original: string; nobg: string; bgBlur: string; assetGroupId: string }>;
    onUploadProgress: (
      cb: (data: {
        assetId: string;
        stage: string;
        percent: number;
        modelDownload?: boolean;
      }) => void,
    ) => () => void;
  };
}

interface Window {
  cads: CadsApi;
}
