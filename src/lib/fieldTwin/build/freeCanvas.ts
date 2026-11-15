// A canvas's pixel store given back now instead of at the next garbage collection: a full-size photograph's canvas is
// 84 MB, and Safari in particular keeps a dropped canvas's memory until it collects (a zero-size canvas holds none).
// Pixels already read (getImageData) are a copy and stay valid.
export function freeCanvas(c: OffscreenCanvas | HTMLCanvasElement): void {
  try { c.width = 0; c.height = 0; } catch { /* a canvas handed to a bitmap renderer cannot be resized: dropped as before */ }
}
