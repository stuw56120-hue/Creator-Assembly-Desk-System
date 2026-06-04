// C.A.D.S. top-level router:
//   setup → ingest (New Project) → import → source → onboarding → proxy → editor.
// Source confirm and Asset Onboarding are explicit steps before the editor.
import { useEffect } from "react";
import { useAppStore, type AppPhase } from "./app/appStore";
import { SetupScreen } from "./app/SetupScreen";
import { IngestScreen } from "./app/IngestScreen";
import { ImportScreen } from "./app/ImportScreen";
import { VideoSourceScreen } from "./app/VideoSourceScreen";
import { ProxyScreen } from "./app/ProxyScreen";
import { AssetOnboarding } from "./onboarding/AssetOnboarding";
import { applyOnboardedImagesToTimeline } from "./project/loadProject";
import { EditorLayout } from "./EditorLayout";
import { EngineBanner } from "./app/EngineBanner";
import { ensureMotionGraphicsEngine } from "./motionGraphics/engineStore";

function screenForPhase(phase: AppPhase, setPhase: (p: AppPhase) => void) {
  switch (phase) {
    case "loading":
      return (
        <div
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
          }}
        >
          Loading…
        </div>
      );
    case "setup":
      return <SetupScreen />;
    case "ingest":
      return <IngestScreen />;
    case "import":
      return <ImportScreen />;
    case "source":
      return <VideoSourceScreen />;
    case "onboarding":
      return (
        <AssetOnboarding
          onContinue={() => {
            // Link the images the user just uploaded to their timeline overlays.
            applyOnboardedImagesToTimeline();
            setPhase("proxy");
          }}
        />
      );
    case "proxy":
      return <ProxyScreen />;
    case "editor":
      return <EditorLayout />;
  }
}

export function App() {
  const phase = useAppStore((s) => s.phase);
  const init = useAppStore((s) => s.init);
  const setPhase = useAppStore((s) => s.setPhase);

  useEffect(() => {
    void init();
    // Download the motion-graphics render engine once, on launch — not lazily
    // when the user first previews a graphic.
    void ensureMotionGraphicsEngine();
  }, [init]);

  return (
    <>
      <EngineBanner />
      {screenForPhase(phase, setPhase)}
    </>
  );
}
