# Landing page video

Real screen captures of the Swardus app, same rule as `public/screens/`:
never a mock-up, never a render. If the UI moves on, take a new capture — don't
dress up an old one.

| File | Shows | Used by |
|---|---|---|
| `cockpit-sim.mp4` / `.webm` | The flight planner running a mission simulation at 32× | Nothing, since 2026-10-08: the cockpit section was cut while the product is in closed testing. Kept for when it comes back. |
| `cockpit-sim-poster.jpg` | Frame 11s in — tank dynamics, transport and full telemetry all visible | Poster for the above |
| `hero.mp4` / `hero-1280.mp4` | The hero film: the Field Twin's largest-weed demo first, at 1.5x (2.7 s), crossfading into the flight cut (real flights, the field, the route and the map); 22.3 s, muted (cut 2026-10-29) | The hero, behind the headline; the 1280 cut for screens under 900 px |
| `hero-poster.jpg` | The demo's first frame, scaled and cropped as in the film, so the still and the film's first second agree | Poster for the above, and all that anyone on reduced motion or a slow connection sees |

## The hero film

Two masters, both gitignored for the same reason as the capture masters below:
`herovideo/Timeline 1.mov` (55 MB, 3840×2160, 30 fps, 20 s, the 2026-10-09 flight cut) and
`additionalherosectionvideo/swarduslargestweeddemo.mp4` (4 MB, 1656×1172, 30 fps, 4 s, a screen
recording of the Field Twin's "Largest individual weeds" filter, 2026-10-28). WebM was tried and came
out larger than the MP4 on this footage, so only MP4 is served.

The served film (2026-10-29) opens on the demo at 1.5x (2.67 s, scaled to the full width and cropped top
and bottom so it fills the 16:9 frame without bars), a 0.4 s crossfade, then the whole flight cut from
its start. 22.3 s in all. The poster is the demo's first frame treated the same way. The earlier cut
(2026-10-28) had the demo spliced in 1 s from the start at 1.2x.

```sh
SRC="herovideo/Timeline 1.mov"; DEMO="additionalherosectionvideo/swarduslargestweeddemo.mp4"
enc() { W=$1; H=$2; OUT=$3; ffmpeg -y -i "$SRC" -i "$DEMO" -filter_complex   "[1:v]setpts=PTS/1.5,fps=30,scale=$W:-2,crop=$W:$H,format=yuv420p[d];   [0:v]trim=0:20.0333,setpts=PTS-STARTPTS,scale=$W:$H,fps=30,format=yuv420p[b];   [d][b]xfade=transition=fade:duration=0.4:offset=2.267[v]"   -map "[v]" -an -c:v libx264 -profile:v high -crf 30 -preset slow -movflags +faststart -pix_fmt yuv420p "$OUT"; }
enc 1920 1080 public/video/hero.mp4        # ~5.8 MB
enc 1280 720 public/video/hero-1280.mp4    # ~3.0 MB
ffmpeg -y -i "$DEMO" -vf "scale=1920:-2,crop=1920:1080" -vframes 1 -q:v 4 public/video/hero-poster.jpg
```

To change the demo's speed, change `PTS/1.5` and the offset (demo seconds at that speed − 0.4).

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

## Which clips play, and in what order

`src/components/landing/heroMedia.ts` is the list. One clip loops; several play in order and wrap. Each entry
names the wide and narrow encodes and a poster frame, and may set `zoom` to crop black bars baked into the
source (the current cut has pillarboxed screen-recording seconds at 12, 13 and 20 s, so it plays at 1.1).

