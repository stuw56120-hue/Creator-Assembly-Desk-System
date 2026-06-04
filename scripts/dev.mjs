import { createServer } from "vite";
import { spawn } from "node:child_process";
import electronPath from "electron";
import { buildMain } from "./build-main.mjs";

// Dev orchestration: bundle main+preload with esbuild (watch), start the Vite
// dev server, then launch Electron pointed at the dev server URL.
async function main() {
  const esbuildCtx = await buildMain({ watch: true });

  const server = await createServer();
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("Vite dev server did not report a local URL");
  server.printUrls();

  const child = spawn(electronPath, ["."], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });

  const shutdown = async () => {
    await esbuildCtx?.dispose();
    await server.close();
    process.exit(0);
  };

  child.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
