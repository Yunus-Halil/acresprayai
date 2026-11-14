// The photo-ground switch (photoGround.ts): the flight's photographs laid under the twin. Off unless the deployment
// is built with VITE_FIELD_TWIN_PHOTO_GROUND=1. Off, nothing about a build or the viewer changes: no stage runs, no
// tile is made, no control is shown, and the twin is the same file. On, the overview is made after the twin and its
// evidence crops are complete and is KEPT IN THIS BROWSER ONLY (never uploaded: retaining growers' photographs needs
// the participant terms to say so); detail and the photographs behind a finding come from the flight's own files on
// this device, on demand.
export function photoGroundEnabled(): boolean {
  try { return import.meta.env?.VITE_FIELD_TWIN_PHOTO_GROUND === "1"; } catch { return false; }
}
