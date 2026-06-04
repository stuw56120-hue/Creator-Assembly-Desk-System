import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");

// Electron's main and preload run in a Node/CJS context. We bundle each to a
// single CommonJS file in dist-electron/. `electron` is provided at runtime, so
// it stays external.
/** @type {import("esbuild").BuildOptions} */
const baseConfig = {
  entryPoints: {
    main: path.join(projectRoot, "electron/main.ts"),
    preload: path.join(projectRoot, "electron/preload.ts"),
  },
  outdir: path.join(projectRoot, "dist-electron"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
};

/**
 * @param {{ watch?: boolean }} [opts]
 */
export async function buildMain(opts = {}) {
  if (opts.watch) {
    const ctx = await context(baseConfig);
    await ctx.rebuild();
    await ctx.watch();
    return ctx;
  }
  await build(baseConfig);
  return null;
}

// Allow `node scripts/build-main.mjs` as a one-shot build.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-main.mjs")) {
  buildMain().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
