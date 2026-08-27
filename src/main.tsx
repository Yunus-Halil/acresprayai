import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";
import { migrateLegacyStorage } from "@/lib/storage";

// Carry any state saved under the old product name across before render.
migrateLegacyStorage();

// The offline shell: precached app shell + runtime-cached data and tiles,
// so a field opened with signal is still viewable standing in one without.
// autoUpdate: a new deploy replaces the worker on next load, no prompt.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);
