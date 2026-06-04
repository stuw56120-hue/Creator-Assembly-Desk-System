import { describe, expect, it } from "vitest";
import {
  audioExtractArgs,
  fileExtension,
  isAcceptedTranscript,
  isAcceptedVideo,
  projectLayout,
  slugifyProjectName,
  transcribeArgs,
} from "./ingestPlan";

const join = (...parts: string[]) => parts.join("/");

describe("slugifyProjectName", () => {
  it("makes a filesystem-safe slug", () => {
    expect(slugifyProjectName("Sweet Relief")).toBe("sweet-relief");
    expect(slugifyProjectName("  Spurs vs. Arsenal!! ")).toBe("spurs-vs-arsenal");
  });
  it("falls back to 'project' for empty/garbage names", () => {
    expect(slugifyProjectName("")).toBe("project");
    expect(slugifyProjectName("???")).toBe("project");
  });
});

describe("file type checks", () => {
  it("reads the extension", () => {
    expect(fileExtension("C:\\Users\\me\\clip.MP4")).toBe("mp4");
    expect(fileExtension("/tmp/a.b.vtt")).toBe("vtt");
    expect(fileExtension("noext")).toBe("");
  });
  it("accepts videos and transcripts by extension", () => {
    expect(isAcceptedVideo("recording.mp4")).toBe(true);
    expect(isAcceptedVideo("recording.pdf")).toBe(false);
    expect(isAcceptedTranscript("zoom.vtt")).toBe(true);
    expect(isAcceptedTranscript("zoom.mp4")).toBe(false);
  });
});

describe("audioExtractArgs", () => {
  it("strips audio to 16kHz mono pcm wav", () => {
    expect(audioExtractArgs("in.mp4", "out.wav")).toEqual([
      "-i", "in.mp4", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", "out.wav",
    ]);
  });
});

describe("transcribeArgs", () => {
  it("passes input/output/model/language", () => {
    expect(transcribeArgs("a.wav", "t.txt", "base", "en")).toEqual([
      "--input", "a.wav", "--output", "t.txt", "--model", "base", "--language", "en",
    ]);
  });
});

describe("projectLayout", () => {
  it("resolves source + submission paths under the projects folder", () => {
    const layout = projectLayout("/projects", "Sweet Relief", join);
    expect(layout.projectDir).toBe("/projects/sweet-relief");
    expect(layout.sourceDir).toBe("/projects/sweet-relief/source");
    expect(layout.submissionDir).toBe("/projects/sweet-relief/submission");
    expect(layout.audioPath).toBe("/projects/sweet-relief/submission/audio.wav");
    expect(layout.transcriptPath).toBe("/projects/sweet-relief/submission/transcript.txt");
  });
});
