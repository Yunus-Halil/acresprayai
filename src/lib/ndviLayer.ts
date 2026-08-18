import { useEffect, useRef } from "react";

/**
 * Whether the vegetation-index layer should start visible for a scan.
 *
 * The decision comes from one place: the index `ndvi-tile/info` reports it is
 * actually serving. That endpoint picks the index from resolved band roles, so
 * asking it "is this real NDVI?" is the same question the tiles themselves are
 * answering - rather than a second, parallel band count that could disagree.
 *
 * Real NDVI (or NDRE) means a NIR band was positively identified by name, which
 * is a calibrated signal worth putting in front of the farmer unasked. VARI is
 * a visible-light proxy computed from RGB; it is explicitly not NDVI and is
 * less reliable, so it stays opt-in rather than being presented as the default
 * view of someone's field. A scan whose band resolution failed falls back to
 * VARI, and is treated as VARI here for exactly the same reason.
 */
export function ndviDefaultVisible(info: { index?: string | null } | null | undefined): boolean {
  const index = info?.index;
  return index === "ndvi" || index === "ndre";
}

/**
 * Applies that default once per scan.
 *
 * Once, deliberately. The info fetch can re-run while a scan is open, and
 * re-applying would undo a farmer who had just switched the layer off - which
 * would read as the toggle being broken. After the first application the layer
 * is entirely theirs, and opening a different scan starts the rule again.
 */
export function useNdviLayerDefault(
  taskId: string | null | undefined,
  info: { index?: string | null } | null | undefined,
  onDefault: (visible: boolean) => void,
) {
  const appliedFor = useRef<string | null>(null);
  // Held in a ref so an inline callback does not re-trigger the effect and
  // re-apply the default on every render.
  const cb = useRef(onDefault);
  cb.current = onDefault;

  useEffect(() => {
    if (!taskId || !info) return;
    if (appliedFor.current === taskId) return;
    appliedFor.current = taskId;
    cb.current(ndviDefaultVisible(info));
  }, [taskId, info]);
}
