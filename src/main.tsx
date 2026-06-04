import React from "react";
import ReactDOM from "react-dom/client";
import "./design/tokens.css";
import { App } from "./App";

// Forward renderer crashes to the main-process log file for diagnosis.
window.addEventListener("error", (e) => {
  window.cads?.log?.error(`window.error: ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  window.cads?.log?.error(`unhandledrejection: ${String(e.reason)}`);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
