/*
 * Stand-in template registry for Step 5 tests. Mirrors the param schemas the
 * real template-registry.json will declare in Step 6, for the templates the
 * real Sweet Relief fixture references (quote_card, subscribe_flash, punch_in),
 * plus the rest of the built-in set. Params follow the real flattened overlay
 * shape (text/placement/duration) and are all optional, so the fixture parses
 * cleanly; defaults are filled into queued build jobs.
 */

import type { TemplateRegistry } from "../editListParser";

export const testRegistry: TemplateRegistry = {
  quote_card: {
    label: "Quote Card",
    compositionPath: "compositions/quote-card/composition.html",
    defaultDuration: 4,
    params: {
      text: { type: "string" },
      attribution: { type: "string" },
      accent_colour: { type: "color", default: "#00c2ff" },
      background_opacity: { type: "number", default: 1 },
      duration: { type: "number", default: 4 },
    },
  },
  subscribe_flash: {
    label: "Subscribe Flash",
    compositionPath: "compositions/subscribe-flash/composition.html",
    defaultDuration: 2.5,
    params: {
      platform: { type: "string", default: "YouTube" },
      accent_colour: { type: "color", default: "#ff0000" },
      duration: { type: "number", default: 2.5 },
    },
  },
  punch_in: {
    label: "Punch In",
    compositionPath: "compositions/punch-in/composition.html",
    defaultDuration: 1.2,
    params: {
      purpose: { type: "string" },
      duration: { type: "number", default: 1.2 },
    },
  },
  topic_banner: {
    label: "Topic Change Banner",
    compositionPath: "compositions/topic-banner/composition.html",
    defaultDuration: 3.4,
    params: {
      title: { type: "string" },
      subtitle: { type: "string" },
      text: { type: "string" },
      accent_colour: { type: "color", default: "#00c2ff" },
      animation_in: { type: "enum", values: ["slide_left", "fade", "pop"], default: "slide_left" },
      duration: { type: "number", default: 3.4 },
    },
  },
  lower_third: {
    label: "Lower Third",
    compositionPath: "compositions/lower-third/composition.html",
    defaultDuration: 4,
    params: {
      name: { type: "string" },
      title: { type: "string" },
      brand_colour: { type: "color", default: "#3b82f6" },
      duration: { type: "number", default: 4 },
    },
  },
  intro_title: {
    label: "Intro Title",
    compositionPath: "compositions/intro-title/composition.html",
    defaultDuration: 3,
    params: {
      title: { type: "string" },
      subtitle: { type: "string" },
      text: { type: "string" },
      background_colour: { type: "color", default: "#0a0a0a" },
      font_colour: { type: "color", default: "#ffffff" },
      duration: { type: "number", default: 3 },
    },
  },
};
