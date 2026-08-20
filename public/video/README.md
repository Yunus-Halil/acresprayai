# Landing page video

Real screen captures of the SwathWise app, same rule as `public/screens/`:
never a mock-up, never a render. If the UI moves on, take a new capture — don't
dress up an old one.

| File | Shows | Used by |
|---|---|---|
| `cockpit-sim.mp4` / `.webm` | The flight planner running a mission simulation at 32× | The Cockpit section |
| `cockpit-sim-poster.jpg` | Frame 11s in — tank dynamics, transport and full telemetry all visible | Poster for the above |

## The master is not in git

The source recording (~16 MB, 2058×912, 30 fps, 8 Mbps) lives at
`src/test/videos/` and is **gitignored on purpose**. A 16 MB binary is in the
history forever once committed, and nothing on the web needs it — only the
encoded derivatives below are served. Keep the master somewhere you can find it
if the clip ever needs re-cutting.

## Re-encoding

Needs `ffmpeg` on PATH. From the repo root, with `$SRC` pointing at the master:

```sh
# MP4 — universal fallback. 16 MB -> ~1.1 MB.
ffmpeg -y -i "$SRC" -an -vf "scale=1440:-2" \
  -c:v libx264 -profile:v high -crf 28 -preset slow \
  -movflags +faststart -pix_fmt yuv420p public/video/cockpit-sim.mp4

# WebM — smaller again where it is supported.
ffmpeg -y -i "$SRC" -an -vf "scale=1440:-2" \
  -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 \
  public/video/cockpit-sim.webm

# Poster. Pick a frame where the panels are populated, not a black first frame.
ffmpeg -y -ss 11 -i "$SRC" -vframes 1 -vf "scale=1440:-2" -q:v 3 \
  public/video/cockpit-sim-poster.jpg
```

Notes on the choices:

- **`-an`** strips audio. It is a silent product loop; shipping an empty audio
  track is bytes for nothing.
- **`+faststart`** moves the MP4 index to the front so playback can begin
  before the file finishes arriving — the difference between "plays" and
  "plays eventually" on a field connection.
- **1440 wide** keeps the app's small mono text legible at the ~720 px the
  frame actually renders at, including on a 2× display. Going wider mostly
  buys file size.
- **Scale, don't crop.** The capture is 2.26:1, which suits a landing band; the
  panels sit at the edges and cropping cuts them off.

## Playback behaviour

`SimVideo.tsx` does not autoplay unconditionally. It loads nothing until the
clip scrolls into view, and skips loading entirely for `prefers-reduced-motion`
or a connection the browser reports as slow or data-saving. The poster is
therefore load-bearing, not decoration: pick a frame that tells the story on
its own, because for some viewers it is the whole story.
