// Corn twins in the viewer: the words and colours for each state, and whether a twin is locally aligned. Shared by
// the corn panel, the inspector and the page (kept out of the component file so hot reload keeps working).
import { TWIN_COLOURS } from "./style";
import type { TwinBundle, TwinCornGap, TwinCornRow, TwinCornWeed } from "./types";

export const CORN_WEED_LABEL: Record<TwinCornWeed["status"], string> = { confirmed: "Weed candidate, confirmed", unconfirmed: "Weed candidate, not confirmed", contested: "Contested: crop or weed" };
export const cornWeedColour = (s: TwinCornWeed["status"]) => (s === "confirmed" ? TWIN_COLOURS.cornWeed : s === "contested" ? TWIN_COLOURS.cornWeedContested : TWIN_COLOURS.cornWeedUnconfirmed);
export const cornGapColour = (s: TwinCornGap["status"]) => (s === "confirmed" ? TWIN_COLOURS.cornGap : TWIN_COLOURS.cornGapWithheld);
export const cornRowColour = (s: TwinCornRow["status"]) => (s === "corn" ? TWIN_COLOURS.cornRow : TWIN_COLOURS.cornRowUnconfirmed);

/** Is this twin's placement local (a test flight's estimated scale), not a place on the map? */
export const isLocalTwin = (twin: TwinBundle) => twin.source.placement?.kind === "local";
