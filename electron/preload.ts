import { contextBridge, ipcRenderer } from "electron";

// The single, audited bridge between renderer and main. Channels are added
// here as IPC handlers come online in later build steps.
contextBridge.exposeInMainWorld("cads", {
  getVersions: () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),

  mgBackground: {
    upload: (args: { projectFolder: string; sourcePath: string }) =>
      ipcRenderer.invoke("mgBackground:upload", args),
    list: (args: { projectFolder: string }) => ipcRenderer.invoke("mgBackground:list", args),
  },

  motionGraphics: {
    build: (args: {
      assetId: string;
      templateId: string;
      params: Record<string, unknown>;
      projectFolder?: string;
    }) => ipcRenderer.invoke("motionGraphic:build", args),
    rebuild: (args: {
      assetId: string;
      templateId: string;
      params: Record<string, unknown>;
      projectFolder?: string;
    }) => ipcRenderer.invoke("motionGraphic:rebuild", args),
    preview: (args: {
      templateId: string;
      params: Record<string, unknown>;
      projectFolder?: string;
    }) => ipcRenderer.invoke("motionGraphic:preview", args),
  },

  assets: {
    scan: () => ipcRenderer.invoke("assets:scan"),
    clean: () => ipcRenderer.invoke("assets:clean"),
    setPlayerName: (args: { imageSubject: string; displayName: string }) =>
      ipcRenderer.invoke("assets:set-player-name", args),
  },

  motionGraphicsEngine: {
    ensureBrowser: () => ipcRenderer.invoke("motionGraphic:ensure-browser"),
    onProgress: (cb: (data: { line: string }) => void) => {
      const listener = (_e: unknown, data: { line: string }) => cb(data);
      ipcRenderer.on("motionGraphic:browser-progress", listener);
      return () => ipcRenderer.removeListener("motionGraphic:browser-progress", listener);
    },
  },

  log: {
    error: (message: string) => ipcRenderer.send("log:renderer", { level: "ERROR", message }),
    info: (message: string) => ipcRenderer.send("log:renderer", { level: "INFO", message }),
  },

  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: { projectsFolder?: string; assetLibraryFolder?: string }) =>
      ipcRenderer.invoke("settings:set", patch),
  },

  dialog: {
    pickFolder: (args: { title?: string }) => ipcRenderer.invoke("dialog:pickFolder", args),
    pickFile: (args: { title?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke("dialog:pickFile", args),
  },

  project: {
    openPath: (target: string) => ipcRenderer.invoke("project:openPath", { target }),
    readText: (filePath: string) => ipcRenderer.invoke("project:readText", { filePath }),
    fileExists: (filePath: string) => ipcRenderer.invoke("project:fileExists", { filePath }),
    save: (args: { projectName: string; snapshot: unknown }) =>
      ipcRenderer.invoke("project:save", args),
    open: (dir: string) => ipcRenderer.invoke("project:open", { dir }),
  },

  ingest: {
    run: (args: {
      projectName: string;
      videoPath: string;
      vttPath?: string;
      language: string;
      model: string;
    }) => ipcRenderer.invoke("ingest:run", args),
    onLog: (cb: (data: { line: string; percent?: number }) => void) => {
      const listener = (_e: unknown, data: { line: string; percent?: number }) => cb(data);
      ipcRenderer.on("ingest:log", listener);
      return () => ipcRenderer.removeListener("ingest:log", listener);
    },
    last: () => ipcRenderer.invoke("ingest:last"),
  },

  render: {
    longform: (plan: unknown) => ipcRenderer.invoke("render:longform", plan),
    short: (plan: unknown) => ipcRenderer.invoke("render:short", plan),
    proxy: (args: { sourcePath: string; durationSeconds: number }) =>
      ipcRenderer.invoke("render:proxy", args),
    onProgress: (cb: (data: { phase: string; percent: number }) => void) => {
      const listener = (_e: unknown, data: { phase: string; percent: number }) => cb(data);
      ipcRenderer.on("render:progress", listener);
      return () => ipcRenderer.removeListener("render:progress", listener);
    },
  },

  image: {
    checkModel: () => ipcRenderer.invoke("image:check-model"),
    downloadModel: () => ipcRenderer.invoke("image:download-model"),
    upload: (args: {
      filePath: string;
      assetId: string;
      suggestedFilename: string;
      imageSubject?: string;
    }) => ipcRenderer.invoke("image:upload", args),
    onUploadProgress: (
      cb: (data: { assetId: string; stage: string; percent: number; modelDownload?: boolean }) => void,
    ) => {
      const listener = (_e: unknown, data: Parameters<typeof cb>[0]) => cb(data);
      ipcRenderer.on("image:upload-progress", listener);
      return () => ipcRenderer.removeListener("image:upload-progress", listener);
    },
  },
});
