"""The seven inspection panels for one PhenoBench sample, and a contact sheet.

A. RGB image
B. semantic classes
C. all plant instances
D. weed-only instances (crops dimmed)
E. leaf instances
F. plant visibility
G. RGB with weed outlines (crop outlines faint)

Colours for instance ids come from a golden-ratio hue walk keyed on the id, so
the same id gets the same colour in every panel and neighbouring ids differ.
"""

from __future__ import annotations

import colorsys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from skimage import measure  # noqa: E402

from weedlab.phenobench.instances import PlantInstance  # noqa: E402
from weedlab.phenobench.reader import (  # noqa: E402
    BACKGROUND,
    CROP,
    PARTIAL_CROP,
    PARTIAL_WEED,
    PLANT_CLASSES,
    WEED,
)

SEMANTIC_COLOURS = {
    BACKGROUND: (40, 40, 40),
    CROP: (60, 180, 75),
    WEED: (230, 40, 40),
    PARTIAL_CROP: (170, 225, 130),
    PARTIAL_WEED: (255, 150, 40),
}
SEMANTIC_LEGEND = [
    ("background", SEMANTIC_COLOURS[BACKGROUND]),
    ("crop", SEMANTIC_COLOURS[CROP]),
    ("weed", SEMANTIC_COLOURS[WEED]),
    ("partial crop", SEMANTIC_COLOURS[PARTIAL_CROP]),
    ("partial weed", SEMANTIC_COLOURS[PARTIAL_WEED]),
]


def semantic_rgb(sem: np.ndarray) -> np.ndarray:
    out = np.zeros(sem.shape + (3,), dtype=np.uint8)
    for cls, colour in SEMANTIC_COLOURS.items():
        out[sem == cls] = colour
    return out


def id_colour(i: int) -> tuple[int, int, int]:
    """Deterministic, well-spread colour for an integer id > 0."""
    h = (i * 0.618033988749895) % 1.0
    s = 0.55 + 0.35 * ((i * 7) % 3) / 2.0
    v = 0.75 + 0.25 * ((i * 11) % 2)
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return int(r * 255), int(g * 255), int(b * 255)


def instance_rgb(inst: np.ndarray, keep: np.ndarray | None = None, dim: tuple[int, int, int] = (90, 90, 90)) -> np.ndarray:
    """Colour each id; ids not in `keep` (when given) are drawn in `dim`."""
    out = np.zeros(inst.shape + (3,), dtype=np.uint8)
    ids = np.unique(inst)
    ids = ids[ids != 0]
    keep_set = set(keep.tolist()) if keep is not None else None
    for i in ids.tolist():
        if keep_set is not None and i not in keep_set:
            out[inst == i] = dim
        else:
            out[inst == i] = id_colour(i)
    return out


def visibility_rgb(vis: np.ndarray, sem: np.ndarray) -> np.ndarray:
    """Plant visibility 0..255 on a viridis ramp, background black."""
    cmap = plt.get_cmap("viridis")
    plant = np.isin(sem, PLANT_CLASSES)
    rgb = (cmap(vis.astype(np.float32) / 255.0)[..., :3] * 255).astype(np.uint8)
    rgb[~plant] = 0
    return rgb


def _contours_for(mask: np.ndarray, bbox: tuple[int, int, int, int]) -> list[np.ndarray]:
    x0, y0, x1, y1 = bbox
    pad = 1
    ys = slice(max(0, y0 - pad), min(mask.shape[0], y1 + pad))
    xs = slice(max(0, x0 - pad), min(mask.shape[1], x1 + pad))
    local = np.pad(mask[ys, xs].astype(np.uint8), 1)
    cs = measure.find_contours(local, 0.5)
    return [c - 1 + np.array([ys.start, xs.start]) for c in cs]


def draw_outlines(ax, plant_instances: np.ndarray, instances: list[PlantInstance], label_ids: bool = True) -> None:
    """Weeds in yellow (partial weeds orange, dashed), crops faint cyan."""
    for p in instances:
        mask = plant_instances == p.instance_id
        if p.kind == "weed":
            colour = "#ffa028" if p.partial else "#ffe600"
            ls = "--" if p.partial else "-"
            lw = 1.4
        elif p.kind == "crop":
            colour = "#40e0ff"
            ls = "--" if p.partial else "-"
            lw = 0.6
        else:
            colour = "#ff00ff"
            ls = ":"
            lw = 1.2
        for c in _contours_for(mask, p.bbox):
            ax.plot(c[:, 1], c[:, 0], color=colour, linestyle=ls, linewidth=lw)
        if label_ids and p.kind == "weed":
            cx, cy = p.centroid
            ax.text(cx, cy, str(p.instance_id), color="white", fontsize=6, ha="center", va="center",
                    bbox=dict(boxstyle="round,pad=0.15", fc="black", ec="none", alpha=0.6))


def render_sample_panels(
    sample,
    instances: list[PlantInstance],
    out_path: Path,
    dpi: int = 110,
) -> None:
    """Write the 2x4 figure of panels A..G plus a text panel with the counts."""
    sem = sample.semantics
    inst = sample.plant_instances
    weed_ids = np.array([p.instance_id for p in instances if p.kind == "weed"], dtype=np.int64)
    n_weed = int(len(weed_ids))
    n_weed_partial = sum(1 for p in instances if p.kind == "weed" and p.partial)
    n_crop = sum(1 for p in instances if p.kind == "crop")
    n_crop_partial = sum(1 for p in instances if p.kind == "crop" and p.partial)
    n_mixed = sum(1 for p in instances if p.mixed)
    n_leaves = int(np.count_nonzero(np.unique(sample.leaf_instances))) if sample.leaf_instances is not None else 0

    fig, axes = plt.subplots(2, 4, figsize=(20, 10.4))
    axes = axes.ravel()
    panels = [
        ("A. RGB", sample.image),
        ("B. semantic classes", semantic_rgb(sem)),
        ("C. plant instances", instance_rgb(inst)),
        ("D. weed instances only (crops dimmed)", instance_rgb(inst, keep=weed_ids)),
        ("E. leaf instances", instance_rgb(sample.leaf_instances) if sample.leaf_instances is not None else np.zeros_like(sample.image)),
        ("F. plant visibility (viridis, 255 = fully visible)", visibility_rgb(sample.plant_visibility, sem) if sample.plant_visibility is not None else np.zeros_like(sample.image)),
        ("G. RGB with weed outlines", sample.image),
    ]
    for ax, (title, img) in zip(axes, panels):
        ax.imshow(img, interpolation="nearest")
        ax.set_title(title, fontsize=10)
        ax.set_xticks([])
        ax.set_yticks([])
    draw_outlines(axes[6], inst, instances)
    # Legend for B.
    for k, (label, colour) in enumerate(SEMANTIC_LEGEND):
        axes[1].text(8, 28 + 30 * k, label, color="white", fontsize=8, va="center",
                     bbox=dict(boxstyle="square,pad=0.3", fc=np.array(colour) / 255.0, ec="none"))
    ax = axes[7]
    ax.axis("off")
    lines = [
        f"{sample.name}",
        f"split {sample.split}   date {sample.meta.date}   plot {sample.meta.plot}",
        "",
        f"weed instances: {n_weed}  (partial {n_weed_partial})",
        f"crop instances: {n_crop}  (partial {n_crop_partial})",
        f"mixed-family instances: {n_mixed}",
        f"leaf instances: {n_leaves}",
        "",
        "G: weed outline yellow, partial weed orange dashed,",
        "   crop outline faint cyan; numbers are weed instance ids",
        "",
        "dtype: " + ", ".join(
            f"{k} {getattr(sample, k).dtype}" for k in ("semantics", "plant_instances", "plant_visibility") if getattr(sample, k) is not None
        ),
    ]
    ax.text(0.02, 0.98, "\n".join(lines), va="top", ha="left", fontsize=10, family="monospace", transform=ax.transAxes)
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=dpi)
    plt.close(fig)


def overlay_image(sample, instances: list[PlantInstance], dpi: int = 100) -> np.ndarray:
    """Panel G alone, rasterised at the image's own size, for the contact sheet."""
    h, w = sample.image.shape[:2]
    fig = plt.figure(figsize=(w / dpi, h / dpi), dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.imshow(sample.image, interpolation="nearest")
    draw_outlines(ax, sample.plant_instances, instances, label_ids=False)
    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)
    ax.axis("off")
    fig.canvas.draw()
    buf = np.asarray(fig.canvas.buffer_rgba())[..., :3].copy()
    plt.close(fig)
    return buf


def contact_sheet(rows: list[tuple[str, list[np.ndarray]]], out_path: Path, cell: int = 256, header: list[str] | None = None) -> None:
    """Rows of equally sized cells with a caption per row; nearest-neighbour downsampled."""
    if not rows:
        raise ValueError("no rows for the contact sheet")
    n_cols = len(rows[0][1])
    cap_h = 22
    head_h = 22 if header else 0
    sheet = Image.new("RGB", (cell * n_cols, head_h + (cell + cap_h) * len(rows)), (20, 20, 20))
    from PIL import ImageDraw

    draw = ImageDraw.Draw(sheet)
    if header:
        for c, text in enumerate(header):
            draw.text((c * cell + 4, 4), text, fill=(230, 230, 230))
    for r, (caption, cells) in enumerate(rows):
        y = head_h + r * (cell + cap_h)
        draw.text((4, y + 4), caption, fill=(230, 230, 230))
        for c, arr in enumerate(cells):
            im = Image.fromarray(arr).resize((cell, cell), Image.NEAREST)
            sheet.paste(im, (c * cell, y + cap_h))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
