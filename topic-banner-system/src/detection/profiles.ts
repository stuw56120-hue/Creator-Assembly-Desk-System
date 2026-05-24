import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import type { DetectionThresholds, DetectionProfileName } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type ProfilesFile = Record<string, DetectionThresholds>;

let profilesCache: ProfilesFile | null = null;

function loadProfiles(): ProfilesFile {
  if (profilesCache) return profilesCache;
  const configPath = join(__dirname, "../../config/detection_profiles.json");
  const raw = readFileSync(configPath, "utf-8");
  profilesCache = JSON.parse(raw) as ProfilesFile;
  return profilesCache;
}

export function resolveProfile(
  name: DetectionProfileName,
  overrides?: Partial<DetectionThresholds>
): DetectionThresholds {
  const profiles = loadProfiles();
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Unknown detection profile: "${name}"`);
  }
  if (!overrides) return { ...profile };
  return { ...profile, ...overrides };
}

export function getProfileNames(): string[] {
  return Object.keys(loadProfiles());
}

export function clearProfileCache(): void {
  profilesCache = null;
}
