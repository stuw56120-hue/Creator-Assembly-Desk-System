import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMotionGraphic,
  parameteriseComposition,
  previewMotionGraphic,
  rebuildMotionGraphic,
  type PipelineDeps,
} from "./buildPipeline";
import { getTemplate } from "./templateRegistry";

const PROJECT_ROOT = "/proj";
const TMP = "/tmp";
const LIB = "/lib/motion_graphics";

/** Build an in-memory fs + mock subprocess runner. */
function makeHarness(opts: { failHyperframes?: boolean } = {}) {
  const store = new Map<string, string>();
  let clock = 0;

  // Seed every built-in composition file the tests touch.
  for (const id of ["quote_card", "subscribe_flash", "topic_banner"]) {
    const path = `${PROJECT_ROOT}/${getTemplate(id).compositionPath}`;
    store.set(path, "<html data-duration=\"{{duration}}\"><body>{{text}}{{params_json}}</body></html>");
  }

  const calls: { cmd: string; args: string[] }[] = [];

  const deps: PipelineDeps = {
    readTextFile: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeTextFile: async (p, c) => void store.set(p, c),
    copyFile: async (from, to) => {
      const v = store.get(from);
      if (v === undefined) throw new Error(`ENOENT ${from}`);
      store.set(to, v);
    },
    fileSize: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v.length;
    },
    ensureDir: async () => {},
    runCommand: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "hyperframes") {
        if (opts.failHyperframes) throw new Error("spawn hyperframes ENOENT");
        // The positional arg must be a project DIRECTORY (not an .html file),
        // and the composition is written as index.html inside it.
        const dir = args[1];
        if (dir.endsWith(".html")) throw new Error(`ENOTDIR: passed a file, not a directory: ${dir}`);
        if (!store.has(`${dir}/index.html`)) throw new Error(`no index.html in ${dir}`);
        const out = args[args.indexOf("--output") + 1];
        store.set(out, `RENDER@${clock}`); // non-empty WebM stand-in
        return { code: 0, stdout: "", stderr: "" };
      }
      if (cmd === "ffmpeg") {
        store.set(args[args.length - 1], "PNGDATA");
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unknown command" };
    },
    join: (...parts) => parts.join("/"),
    now: () => ++clock,
  };

  return { deps, store, calls };
}

const baseReq = {
  assetId: "overlay_001",
  templateId: "quote_card",
  params: { text: "Sweet Relief" },
  projectRoot: PROJECT_ROOT,
  tmpDir: TMP,
  libraryDir: LIB,
};

describe("parameteriseComposition", () => {
  it("substitutes tokens, injects params JSON, and clears leftovers", () => {
    const html =
      '<html data-duration="{{duration}}" data-fps="{{fps}}"><b>{{text}}</b><i>{{missing}}</i>' +
      "<script>const P={{params_json}};</script></html>";
    const out = parameteriseComposition(html, { duration: 4, text: "Hi & <there>" });
    expect(out).toContain('data-duration="4"');
    expect(out).toContain('data-fps="30"');
    expect(out).toContain("Hi &amp; &lt;there&gt;"); // escaped
    expect(out).toContain('const P={"duration":4,"text":"Hi & <there>"};'); // raw JSON
    expect(out).not.toContain("{{"); // no leftover tokens
  });

  it("injects background_image_url (and all params) into the params JSON", () => {
    // Bug 4: the background image must reach the composition. It rides in via
    // {{params_json}}, which the composition reads as window.__CADS_PARAMS__.
    const html = "<script>window.__CADS_PARAMS__ = {{params_json}};</script>";
    const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
    const out = parameteriseComposition(html, {
      text: "Quote",
      background_image_url: dataUrl,
      background_image_opacity: 30,
      background_image_fit: "cover",
    });
    const json = JSON.parse(out.replace(/^.*= /, "").replace(/;<\/script>$/, ""));
    expect(json.background_image_url).toBe(dataUrl);
    expect(json.background_image_opacity).toBe(30);
    expect(json.background_image_fit).toBe("cover");
  });
});

describe("buildMotionGraphic", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("produces a .webm asset in the library with a thumbnail", async () => {
    const result = await buildMotionGraphic(baseReq, h.deps);
    expect(result.assetPath).toBe(`${LIB}/overlay_001.webm`);
    expect(h.store.has(`${LIB}/overlay_001.webm`)).toBe(true);
    expect((await h.deps.fileSize(result.assetPath)) > 0).toBe(true);
    expect(result.thumbnailPath).toBe(`${LIB}/overlay_001.thumb.png`);
    expect(result.durationSeconds).toBe(4); // quote_card default
  });

  it("rebuild overwrites the existing cached WebM", async () => {
    await buildMotionGraphic(baseReq, h.deps);
    const first = h.store.get(`${LIB}/overlay_001.webm`);
    await rebuildMotionGraphic({ ...baseReq, params: { text: "Updated" } }, h.deps);
    const second = h.store.get(`${LIB}/overlay_001.webm`);
    expect(second).not.toBe(first); // content replaced
    // Still a single cached asset at the same path.
    const webmKeys = [...h.store.keys()].filter((k) => k === `${LIB}/overlay_001.webm`);
    expect(webmKeys).toHaveLength(1);
  });

  it("surfaces a clean error when the Hyperframes CLI is missing", async () => {
    const failing = makeHarness({ failHyperframes: true });
    await expect(buildMotionGraphic(baseReq, failing.deps)).rejects.toThrow(/Hyperframes CLI/);
  });

  it("rejects invalid params before rendering", async () => {
    // quote_card requires `text`; omit it.
    await expect(
      buildMotionGraphic({ ...baseReq, params: {} }, h.deps),
    ).rejects.toThrow(/Invalid params/);
    expect(h.calls.find((c) => c.cmd === "hyperframes")).toBeUndefined(); // never rendered
  });
});

describe("previewMotionGraphic", () => {
  it("writes a preview to the temp dir and not the library", async () => {
    const h = makeHarness();
    const { previewPath, durationSeconds } = await previewMotionGraphic(baseReq, h.deps);
    expect(previewPath.startsWith(`${TMP}/`)).toBe(true);
    expect(h.store.has(previewPath)).toBe(true);
    expect([...h.store.keys()].some((k) => k.startsWith(`${LIB}/`))).toBe(false);
    expect(durationSeconds).toBe(4);
  });
});
