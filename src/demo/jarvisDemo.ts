// DEMO_JARVIS — temporary conference-demo dressing for the Treatment Grid.
//
// TO REMOVE: delete this folder (src/demo) and every line in
// components/app/workspace/TreatmentTab.tsx tagged `DEMO_JARVIS`. Nothing else
// depends on it. Flip the flag below to false to switch it off without
// deleting anything.
//
// What is real and what is scripted, so nobody on stage says the wrong thing:
//   REAL      the cell count, pixels per cell, number of marked examples, the
//             candidate cells the lines branch to, and every area / volume /
//             rate figure — all come from the actual Find Similar run and the
//             operator's own rate setting.
//   SCRIPTED  the species. The app has no weed classifier yet; the carousel
//             settles on DEMO_TARGET_KEY every time. The agronomy text is
//             accurate for that species in Northern Virginia but it is a
//             label chosen here, not one the imagery produced.
export const DEMO_JARVIS_SCAN = true;

export type DemoWeed = {
  key: string;
  common: string;
  latin: string;
  /** Stroke-only SVG path in a 32×32 box. */
  glyph: string;
};

/**
 * Weeds a Northern Virginia row-crop grower actually fights, per the Virginia
 * Tech Pest Management Guide (field crops). Order is the carousel order.
 */
export const DEMO_WEED_CAROUSEL: DemoWeed[] = [
  {
    key: "ragweed", common: "Common ragweed", latin: "Ambrosia artemisiifolia",
    glyph: "M16 30V12M16 24c-5 0-8-3-9-8M16 24c5 0 8-3 9-8M16 18c-4 0-6-2-7-6M16 18c4 0 6-2 7-6M16 12c-2-1-3-3-3-6M16 12c2-1 3-3 3-6",
  },
  {
    key: "horseweed", common: "Horseweed (marestail)", latin: "Erigeron canadensis",
    glyph: "M16 30V4M16 26h-6M16 26h6M16 22h-5M16 22h5M16 18h-4M16 18h4M16 14h-3M16 14h3M16 10h-2M16 10h2",
  },
  {
    key: "palmer", common: "Palmer amaranth", latin: "Amaranthus palmeri",
    glyph: "M16 30V6M16 22c-4-1-6-4-7-8M16 22c4-1 6-4 7-8M16 14c-3-1-4-3-5-6M16 14c3-1 4-3 5-6M16 6l-1.5-3M16 6l1.5-3M16 4v-2",
  },
  {
    key: "johnsongrass", common: "Johnsongrass", latin: "Sorghum halepense",
    glyph: "M16 30c0-8 2-14 8-20M16 30c0-8-2-14-8-20M16 30V8M16 12c3-2 6-2 9 0",
  },
  {
    key: "lambsquarters", common: "Common lambsquarters", latin: "Chenopodium album",
    glyph: "M16 30V18M16 18l-7-5 7-9 7 9z",
  },
  {
    key: "morningglory", common: "Morningglory", latin: "Ipomoea spp.",
    glyph: "M16 30c0-6-4-8-6-12M10 18c0-4 3-6 6-3 3-3 6-1 6 3 0 5-6 8-6 8s-6-3-6-8",
  },
  {
    key: "foxtail", common: "Giant foxtail", latin: "Setaria faberi",
    glyph: "M14 30c0-10 2-16 6-20M20 10c2 1 3 3 3 5M20 10c-2 1-3 3-3 5M19 13c2 1 3 3 3 5M19 13c-2 1-3 3-3 5",
  },
  {
    key: "crabgrass", common: "Large crabgrass", latin: "Digitaria sanguinalis",
    glyph: "M16 30c-6-2-10-6-12-10M16 30c6-2 10-6 12-10M16 30c-2-6-2-12 0-18M16 30c4-4 8-6 12-6M16 30c-4-4-8-6-12-6",
  },
];

/** Which carousel entry the scan settles on. Change here to swap the story. */
export const DEMO_TARGET_KEY = "palmer";

/** Copy for the identified-weed card and the treatment card. */
export const DEMO_TARGET_TEXT = {
  identity: "Broadleaf · summer annual · glyphosate-resistant populations confirmed in Virginia",
  // Palmer's taproot and fast canopy strip soil moisture from the crop row:
  // the ground under a stand dries first, which is why it shows up as patchy
  // bare or stressed ground before the plant itself is obvious from the air.
  finding:
    "Deep taproot and a canopy that adds 2–3 in a day in July heat. It pulls soil " +
    "moisture out from under the crop row, so the ground beneath a stand dries first. " +
    "The dry, bare patches around your marked cells are consistent with that pattern.",
  program: [
    {
      label: "Herbicide",
      text: "Glufosinate (Group 10) at 32 fl oz/ac, or fomesafen (Group 14). Not glyphosate alone: resistance is widespread in this region.",
    },
    {
      label: "Timing",
      text: "Spray before plants pass 4 in. Control drops sharply above that height, and it gets there in days.",
    },
    {
      label: "Nutrition",
      text: "Hold nitrogen on the flagged cells until control is confirmed. Fertilising a dry patch now feeds the weed, not the crop.",
    },
  ],
  caveat: "Check the label for your crop and rate before spraying.",
} as const;
