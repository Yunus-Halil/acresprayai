// The photograph's soil and corn colours for the Realistic view (cornColours.ts): read from decoded pixels, a few
// hundred pixel reads, robust to a plant mark that sits a pixel or two off its leaf.
import { describe, expect, it } from "vitest";
import { COLOUR_SAMPLING, fieldColour, samplePhotoColours } from "@/lib/fieldTwin/cornColours";

const SOIL = [150, 120, 90], LEAF = [70, 140, 50];

/** A soil-coloured photograph with a 5 x 5 leaf at each plant. */
function photo(W: number, H: number, plants: [number, number][], soil = SOIL, leaf = LEAF) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let k = 0; k < W * H; k++) { rgba[4 * k] = soil[0]; rgba[4 * k + 1] = soil[1]; rgba[4 * k + 2] = soil[2]; rgba[4 * k + 3] = 255; }
  for (const [x, y] of plants) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const k = 4 * ((y + dy) * W + x + dx); rgba[k] = leaf[0]; rgba[k + 1] = leaf[1]; rgba[k + 2] = leaf[2]; }
  return { width: W, height: H, rgba };
}
const spread = (n: number, W: number, H: number): [number, number][] => Array.from({ length: n }, (_, i) => [20 + ((i * 37) % (W - 40)), 20 + ((i * 53) % (H - 40))]);

describe("samplePhotoColours", () => {
  it("reads the soil from the grid and the corn from the plants", () => {
    const plants = spread(60, 400, 300), c = samplePhotoColours(photo(400, 300, plants), plants);
    expect(c.soil).toEqual(SOIL);
    expect(c.corn).toEqual(LEAF);
    expect(c.cornFrom).toBe("plants");
    expect(c.cornN).toBeLessThanOrEqual(COLOUR_SAMPLING.plants);
  });

  it("tells a tan soil from dark olive seedlings (the soil's own excess green is not zero)", () => {
    // A sandy seedling field: soil about [152, 141, 116] (2g - r - b = 14), leaves about [80, 78, 48] (28).
    const tan = [152, 141, 116], olive = [80, 78, 48], plants = spread(60, 400, 300);
    const c = samplePhotoColours(photo(400, 300, plants, tan, olive), plants);
    expect(c.soil).toEqual(tan);
    expect(c.corn).toEqual(olive);
    expect(c.soilN).toBeGreaterThan(400);
  });

  it("gives no soil colour under a closed canopy", () => {
    const leaf = [60, 130, 50], c = samplePhotoColours(photo(400, 300, [], leaf, leaf), []);
    expect(c.soil).toBeNull();
  });

  it("finds the leaf when the mark is a few pixels off it", () => {
    const plants = spread(40, 400, 300), off = plants.map(([x, y]) => [x + 4, y - 4] as [number, number]);
    expect(samplePhotoColours(photo(400, 300, plants), off).corn).toEqual(LEAF);
  });

  it("gives no corn colour where the marks stand on soil", () => {
    const c = samplePhotoColours(photo(400, 300, []), spread(40, 400, 300));
    expect(c.corn).toBeNull();
    expect(c.soil).toEqual(SOIL);
  });

  it("with no plant located, takes the corn colour from the green pixels of the grid", () => {
    // A canopy: the left half of the frame is leaf.
    const p = photo(400, 300, []);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 200; x++) { const k = 4 * (y * 400 + x); p.rgba[k] = LEAF[0]; p.rgba[k + 1] = LEAF[1]; p.rgba[k + 2] = LEAF[2]; }
    const c = samplePhotoColours(p, []);
    expect(c.cornFrom).toBe("green");
    expect(c.corn).toEqual(LEAF);
    expect(c.soil).toEqual(SOIL);
  });

  it("leaves shadow and glare out of the soil", () => {
    const p = photo(400, 300, []);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 400; x++) { const k = 4 * (y * 400 + x); p.rgba[k] = p.rgba[k + 1] = p.rgba[k + 2] = 8; }
    expect(samplePhotoColours(p, []).soil).toEqual(SOIL);
  });

  it("changes nothing in the pixels it reads", () => {
    const plants = spread(30, 200, 150), p = photo(200, 150, plants), before = p.rgba.slice();
    samplePhotoColours(p, plants);
    expect(p.rgba).toEqual(before);
  });

  it("gives nothing for a frame too small to sample", () => {
    expect(samplePhotoColours({ width: 4, height: 4, rgba: new Uint8ClampedArray(64) }, [])).toMatchObject({ soil: null, corn: null });
  });
});

describe("fieldColour", () => {
  it("is the median per channel, nulls left out", () => {
    expect(fieldColour([[10, 20, 30], null, [30, 40, 50], [20, 90, 10]])).toEqual([20, 40, 30]);
    expect(fieldColour([null, null])).toBeNull();
  });
});
