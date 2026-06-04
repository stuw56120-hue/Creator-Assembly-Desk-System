import { app, BrowserWindow, ipcMain, protocol } from "electron";
import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { initLogging, writeLog } from "./logger";
import { registerMotionGraphicsHandlers } from "./ipc/motionGraphicsHandlers";
import { registerAssetHandlers } from "./ipc/assetHandlers";
import { registerImageProcessingHandlers } from "./ipc/imageProcessingHandlers";
import { registerFfmpegHandlers } from "./ipc/ffmpegHandlers";
import { registerProjectHandlers } from "./ipc/projectHandlers";
import { registerTranscribeHandlers } from "./ipc/transcribeHandlers";
import { registerMgBackgroundHandlers } from "./ipc/mgBackgroundHandlers";

// Set by scripts/dev.mjs when running `pnpm dev`. Absent in a packaged build,
// where we load the Vite-built index.html from disk instead.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// A privileged scheme to serve local library/project files to the renderer.
// Chromium forbids loading file:// resources from the dev server's http origin,
// so images/video use cads-asset://local/<encoded absolute path> instead.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "cads-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

function mimeType(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#16181d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  initLogging();

  // Serve local files (library images, motion graphic WebMs, the proxy video) to
  // the renderer. cads-asset://local/<encoded absolute path>. Range requests are
  // honoured so the <video> element can SEEK — essential for scrubbing and for
  // skipping cut regions during playback (a jump sets video.currentTime forward,
  // which the browser fulfils with a Range request).
  protocol.handle("cads-asset", async (request) => {
    try {
      const filePath = decodeURIComponent(request.url.replace(/^cads-asset:\/\/local\//, ""));
      const total = (await stat(filePath)).size;
      const contentType = mimeType(filePath);

      const range = request.headers.get("Range");
      const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
      if (match) {
        let start = match[1] ? Number(match[1]) : 0;
        let end = match[2] ? Number(match[2]) : total - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (start > end) start = 0;
        const stream = Readable.toWeb(
          createReadStream(filePath, { start, end }),
        ) as unknown as ReadableStream<Uint8Array>;
        return new Response(stream, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(end - start + 1),
          },
        });
      }

      const stream = Readable.toWeb(
        createReadStream(filePath),
      ) as unknown as ReadableStream<Uint8Array>;
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
          "Content-Length": String(total),
        },
      });
    } catch (err) {
      writeLog("ERROR", "cads-asset fetch failed:", err);
      return new Response(null, { status: 404 });
    }
  });

  // Renderer-forwarded logs (window errors, React crashes) → same log file.
  ipcMain.on("log:renderer", (_e, payload: { level?: string; message?: string }) => {
    writeLog(`RENDERER:${payload?.level ?? "INFO"}`, payload?.message ?? "");
  });

  registerMotionGraphicsHandlers();
  registerAssetHandlers();
  registerImageProcessingHandlers();
  registerFfmpegHandlers();
  registerProjectHandlers();
  registerTranscribeHandlers();
  registerMgBackgroundHandlers();
  createMainWindow();

  // macOS convention; harmless on Windows where the app quits on window close.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
