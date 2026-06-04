/*
 * Composition-side smoke tests for the per-MG background image.
 *
 * Each eligible composition that ships with C.A.D.S. must:
 *  • Contain the `<div class="cads-bg-image" id="cadsBgImage">` element so the
 *    inline IIFE can populate its style.
 *  • Contain the runtime helper that reads window.__CADS_PARAMS__ and applies
 *    the cover / contain / tile fit modes plus 0–100 → 0–1 opacity.
 *  • Sit visually between any backdrop layer and the text/graphic content
 *    (template-specific DOM-order check below).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

interface Spec {
  file: string;
  /** Selectors / id-attrs the bg div must sit BEFORE in DOM order (so foreground stacks on top). */
  mustComeBefore: string[];
  /** Selectors / id-attrs the bg div may sit AFTER (e.g. an existing scrim/backdrop). */
  mayComeAfter?: string[];
}

const SPECS: Spec[] = [
  // quote_card has a dark scrim that animates in for text readability. The
  // user's bg image sits ABOVE the scrim (so it's visible) and BELOW the card.
  {
    file: "compositions/quote-card/composition.html",
    mustComeBefore: ['id="card"'],
    mayComeAfter: ['id="scrim"'],
  },
  {
    file: "compositions/punch-in/composition.html",
    mustComeBefore: ['id="ring"', 'id="label"'],
  },
  {
    file: "compositions/subscribe-flash/composition.html",
    mustComeBefore: ['id="sub"'],
  },
];

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

describe.each(SPECS)("$file background support", (spec) => {
  const html = read(spec.file);

  it("declares the .cads-bg-image element filling its bounding box", () => {
    expect(html).toMatch(/class="cads-bg-image"/);
    expect(html).toMatch(/id="cadsBgImage"/);
    expect(html).toMatch(/\.cads-bg-image\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/);
  });

  it("reads background_image_url / opacity / fit from window.__CADS_PARAMS__", () => {
    expect(html).toContain("background_image_url");
    expect(html).toContain("background_image_opacity");
    expect(html).toContain("background_image_fit");
  });

  it("implements all three fit modes (cover/contain/tile)", () => {
    expect(html).toMatch(/backgroundSize\s*=\s*"cover"/);
    expect(html).toMatch(/backgroundSize\s*=\s*"contain"/);
    expect(html).toMatch(/backgroundSize\s*=\s*"270px auto"/);
    expect(html).toMatch(/backgroundRepeat\s*=\s*"repeat"/);
  });

  it("converts opacity from 0-100 → 0-1 with clamp", () => {
    expect(html).toMatch(/Math\.max\(0,\s*Math\.min\(100,\s*op\)\)\s*\/\s*100/);
  });

  it("sits before the template's foreground content in DOM order", () => {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    expect(bodyMatch).not.toBeNull();
    if (!bodyMatch) return;
    const body = bodyMatch[1];
    const bgIdx = body.indexOf('id="cadsBgImage"');
    expect(bgIdx).toBeGreaterThanOrEqual(0);
    for (const sel of spec.mustComeBefore) {
      const fgIdx = body.indexOf(sel);
      expect(fgIdx).toBeGreaterThan(bgIdx);
    }
  });

  if (spec.mayComeAfter) {
    it("sits after the template's existing backdrop in DOM order", () => {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      if (!bodyMatch) return;
      const body = bodyMatch[1];
      const bgIdx = body.indexOf('id="cadsBgImage"');
      for (const sel of spec.mayComeAfter!) {
        const bdIdx = body.indexOf(sel);
        // Both must be present; the backdrop must come earlier in DOM order so
        // the bg image (and the user's chosen opacity) is what shows through.
        expect(bdIdx).toBeGreaterThanOrEqual(0);
        expect(bdIdx).toBeLessThan(bgIdx);
      }
    });

    it("hides every mayComeAfter backdrop element when no bg image is attached", () => {
      // Regression guard for the universal-scrim bug: when there's no bg image
      // URL, the IIFE must take down the existing backdrop too — otherwise it
      // renders as a full-frame opaque rectangle blocking the underlying video.
      // The whole `!P.background_image_url` branch (across multiple lines) is
      // matched so DOM-order changes don't fool a single-line regex.
      const gateBlock = html.match(/if\s*\(\s*!P\.background_image_url\s*\)\s*\{[\s\S]*?return;\s*\}/);
      expect(gateBlock).not.toBeNull();
      if (!gateBlock) return;
      for (const sel of spec.mayComeAfter!) {
        const idMatch = sel.match(/id="([^"]+)"/);
        if (!idMatch) continue;
        // The variable name in the IIFE is conventionally the id (e.g. const
        // scrim = document.getElementById("scrim")). Assert that variable's
        // .style.display lands at "none" inside the no-bg branch.
        expect(gateBlock[0]).toMatch(new RegExp(`${idMatch[1]}[^\\n]*display\\s*=\\s*"none"`));
      }
    });
  }
});
