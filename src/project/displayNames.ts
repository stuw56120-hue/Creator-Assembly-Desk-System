/*
 * Player display names.
 *
 * The customGPT references a player by an internal `image_subject` slug (e.g.
 * "matis_tel"). The user can give that player a human display name ("Mathis
 * Tel") which is what should appear everywhere on screen and in the render —
 * topic banners, chapter titles, motion graphic text, and captions.
 *
 * These helpers normalise the slug to a default name and rewrite the player's
 * reference in a TimelineEvent's text fields. Substitution is separator- and
 * case-insensitive (matches "matis_tel", "matis-tel", "Matis Tel"), so it works
 * both at load (slug → default name) and on edit (old name → new name).
 */

import type { TimelineEvent } from "./types";

/** "matis_tel" → "Matis Tel". */
export function humanizeSubject(subject: string): string {
  return subject
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace a player reference (`from`, given as a slug or a name) with `to` in a
 * single text string. Word parts of `from` may be separated by spaces, hyphens
 * or underscores in the text.
 */
export function replacePlayerReference(text: string, from: string, to: string): string {
  const parts = from
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(escapeRegex);
  if (parts.length === 0) return text;
  const re = new RegExp(`\\b${parts.join("[\\s_-]+")}\\b`, "gi");
  return text.replace(re, to);
}

/**
 * Rewrite every place a player is referenced across the timeline events:
 * clip/chapter labels, caption text, short hooks, and motion graphic params
 * (topic banner / MG text). Returns a new events array; unchanged when from===to.
 */
export function applyDisplayNameToEvents(
  events: TimelineEvent[],
  from: string,
  to: string,
): TimelineEvent[] {
  if (!from || !to || from === to) return events;
  const r = (s: string) => replacePlayerReference(s, from, to);

  return events.map((e) => {
    const next: TimelineEvent = { ...e, label: r(e.label) };
    if (e.captionData) {
      next.captionData = { ...e.captionData, text: r(e.captionData.text) };
    }
    if (e.shortData) {
      next.shortData = { ...e.shortData, hook: r(e.shortData.hook) };
    }
    if (e.motionGraphicData) {
      const params: Record<string, unknown> = { ...e.motionGraphicData.params };
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === "string") params[k] = r(v);
      }
      next.motionGraphicData = { ...e.motionGraphicData, params };
    }
    return next;
  });
}
