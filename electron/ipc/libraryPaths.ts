/*
 * Resolves the Asset Library root for the whole main process.
 *
 * The user picks an Asset Library folder during first-time Setup (stored in
 * cads-settings.json as `assetLibraryFolder`). Player images, motion-graphic
 * WebMs, and library_index.json all live under that folder. When it isn't set
 * (fresh install, or before Setup) we fall back to userData/library so the app
 * still works out of the box.
 */

import { app } from "electron";
import { readFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

function settingsPath(): string {
  return path.join(app.getPath("userData"), "cads-settings.json");
}

function fallbackRoot(): string {
  return path.join(app.getPath("userData"), "library");
}

/** The configured Asset Library folder, or undefined when Setup hasn't run. */
async function configuredAssetLibraryFolder(): Promise<string | undefined> {
  try {
    const settings = JSON.parse(await readFile(settingsPath(), "utf8")) as {
      assetLibraryFolder?: string;
    };
    const folder = settings.assetLibraryFolder?.trim();
    return folder ? folder : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The library root: the user's configured Asset Library folder when set,
 * otherwise userData/library. Read-only — does not create anything.
 */
export async function resolveLibraryRoot(): Promise<string> {
  return (await configuredAssetLibraryFolder()) ?? fallbackRoot();
}

/**
 * Resolve the library root and make sure it's writable (creating it if needed),
 * surfacing a plain-English error if the configured folder can't be reached —
 * e.g. the NAS is disconnected. Returns the root on success.
 */
export async function ensureLibraryWritable(): Promise<string> {
  const root = await resolveLibraryRoot();
  const configured = await configuredAssetLibraryFolder();
  try {
    await mkdir(root, { recursive: true });
    await access(root); // confirm it's actually there after creating
    return root;
  } catch {
    if (configured) {
      throw new Error(
        `Can't reach your Asset Library folder:\n${configured}\n\n` +
          "If it's on a network drive (NAS), check that it's connected and try again. " +
          "You can also pick a different folder in Setup.",
      );
    }
    throw new Error("Couldn't create the local Asset Library folder. Check disk space and permissions.");
  }
}
