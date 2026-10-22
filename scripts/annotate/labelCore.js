// The labelling tool's arithmetic, apart from the page so it can be tested (src/test/annotateCore.test.ts).
// A classic script, not a module: annotate.html is opened straight from disk, where a browser refuses module imports.
// Every coordinate here is in the PHOTO's native pixels unless it says otherwise.
(function (root) {
  /** A drag shorter than this many screen pixels is a click: a point label, no size. */
  const CLICK_PX = 4;

  /** The diameter a drag from a weed's centre to its edge gives, cm: twice the drag's length in photo pixels times the photo's cm per pixel. Null without a pixel size. */
  function diameterCmFromDrag(cx, cy, ex, ey, gsdCmPx) {
    if (!(gsdCmPx > 0)) return null;
    const r = Math.hypot(ex - cx, ey - cy);
    return +(2 * r * gsdCmPx).toFixed(2);
  }

  /** The disc's radius in photo pixels for a label's diameter. */
  const radiusPx = (diameterCm, gsdCmPx) => (diameterCm > 0 && gsdCmPx > 0 ? diameterCm / gsdCmPx / 2 : null);

  /** A label is in a region when its CENTRE is: a weed touching the outline counts when its centre is inside. Right and bottom edges are outside. */
  const inside = (x, y, region) => !!region && x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;

  /** Labels in the region, with and without a diameter. `labels` carry photo x, y. */
  function regionCounts(labels, region) {
    const inR = labels.filter(l => inside(l.x, l.y, region));
    const sized = inR.filter(l => l.diameterCm > 0).length;
    const weeds = inR.filter(l => l.cls === "weed");
    return { inside: inR.length, sized, unsized: inR.length - sized, weeds: weeds.length, weedsSized: weeds.filter(l => l.diameterCm > 0).length };
  }

  /** The next weed or uncertain label in the region with no diameter, after index `from`, wrapping round; -1 when every one is sized. Crop labels are never asked for a size. */
  function nextUnsized(labels, region, from) {
    const n = labels.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from ?? -1) + k) % n + n) % n;
      const l = labels[i];
      if (l.cls !== "crop" && !(l.diameterCm > 0) && inside(l.x, l.y, region)) return i;
    }
    return -1;
  }

  /**
   * The export, format swardus-region-labels-v1. `labels` carry photo x, y and the image's own rx, ry. With a region
   * active, every label whose centre is inside it is tagged `exhaustiveRegion: <id>` (it was saved in that region's
   * exhaustive pass); a label outside keeps the tag it came with, if any.
   */
  function exportLabels(labels, o) {
    const active = o.activeRegion || null;
    return {
      format: "swardus-region-labels-v1",
      image: o.imageName, photo: o.photo ?? null, region: o.region ?? null, gsdCmPx: o.gsdCmPx ?? null,
      annotator: o.annotator ?? null, exportedAt: o.exportedAt ?? new Date().toISOString(),
      exhaustive: !!o.exhaustive,
      activeRegion: active ? active.id : null,
      labels: labels.map((l, i) => {
        const tag = active && inside(l.x, l.y, active) ? active.id : (l.exhaustiveRegion ?? null);
        const out = {
          id: `${o.idPrefix}:L${i + 1}`, cls: l.cls, x: l.x, y: l.y, regionX: l.rx, regionY: l.ry,
          diameterCm: l.diameterCm ?? null, shadow: !!l.shadow, labelledAt: l.at, priorId: l.prior ?? null,
        };
        if (tag) out.exhaustiveRegion = tag;
        return out;
      }),
    };
  }

  root.LabelCore = { CLICK_PX, diameterCmFromDrag, radiusPx, inside, regionCounts, nextUnsized, exportLabels };
})(typeof globalThis !== "undefined" ? globalThis : this);
