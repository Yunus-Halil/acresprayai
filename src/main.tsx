import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { migrateLegacyStorage } from "@/lib/storage";

// Carry any state saved under the old product name across before render.
migrateLegacyStorage();

createRoot(document.getElementById("root")!).render(<App />);
