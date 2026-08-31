// The app's stacking order, in one place, because it has now been got wrong
// twice for the same underlying reason.
//
// WHY THE STOCK z-50 IS NOT ENOUGH. Leaflet's own CSS puts map panes at
// z-index 400-700 and its controls at 1000, and `.leaflet-container` sets
// `position: relative` WITHOUT a z-index, so it creates no stacking context and
// those panes compete directly with anything portalled to <body>. A z-50
// overlay renders BEHIND an open map: the thing mounts, focus moves into it,
// and the user sees nothing at all.
//
// WHY TWO TIERS. Dialogs, sheets and drawers were raised to 2000 to clear the
// map. The transient layers that open FROM those surfaces (a Select, a
// dropdown, a popover, a tooltip) were left at z-50, so every picker inside
// every dialog in this app rendered behind the dialog that owns it. Both are
// portalled to <body> as siblings, so the numbers decide, and 50 loses to 2000.
// The aircraft picker on the fleet registration form is where that finally got
// noticed; it was never specific to that picker.
//
// So: a SURFACE is a thing you open and interact with. A FLOATING layer is a
// thing that opens on top of whatever surface you are already in, and it must
// always outrank it. Anything transient sits above anything persistent.
//
// The app's own hand-rolled overlays live below both, from z-[1] up to the
// z-[2000] workspace menus; those are inside the page rather than portalled, so
// they stack against the map, not against these.

/**
 * Modal surfaces: dialog, alert dialog, sheet, drawer, and their overlays.
 *
 * Above Leaflet's panes and controls, and above every in-page overlay the
 * workspace draws over the map.
 */
export const Z_SURFACE = "z-[2000]";

/**
 * Transient floating layers: select, dropdown menu, context menu, menubar
 * menu, popover, hover card, tooltip.
 *
 * Deliberately ABOVE `Z_SURFACE`. These open from inside a surface and are
 * dismissed before it is, so they are never the thing that should be covered.
 * A picker that renders behind the dialog containing it is unusable, and it
 * looks like the click did nothing.
 */
export const Z_FLOATING = "z-[2100]";
