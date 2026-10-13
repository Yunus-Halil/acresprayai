"""Match predicted components to reference plant instances and classify every outcome.

Definitions, all on pixel sets:

- overlap(D, R) = |D ∩ R|; IoU(D, R) = |D ∩ R| / |D ∪ R|; coverage(R by D) = |D ∩ R| / |R|.
- Matching at threshold tau: pairs (D, weed R) with IoU >= tau, taken greedily
  in descending IoU, one to one. Done for each tau in IOU_THRESHOLDS. A matched
  D is a true positive at that tau; an unmatched D is a false positive; an
  unmatched weed R is a false negative. Crop instances are never matched;
  they only explain false positives.
- found (coverage recall): R is found when some single D covers >= 0.5 of it,
  whatever the IoU. This separates "the weed was detected" from "the weed was
  delineated", which IoU conflates when a weed is merged into a crop.
- merged: for R's best-covering D (coverage >= 0.5), the other plant instances
  that D also covers >= 0.5. Counted separately as merged_with_weed and
  merged_with_crop.
- split: the number of D with coverage >= 0.2 of R; split when >= 2.
- false-positive kind for an unmatched D: by the majority of its pixels,
  "crop" (on crop-family semantic pixels), "weed" (on weed-family pixels of
  references it did not match, i.e. a duplicate or a fragment), else
  "background" (soil, shadow, residue, stones).
- vegetation pixel IoU: the union of all D against all plant pixels, and
  against weed pixels only; a diagnostic of the index, not a detection score.

The reference instances come from extract_plant_instances on the reference
masks; the category and size band of each reference weed are looked up in the
frozen Phase 2 table and never recomputed here.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from weedlab.phenobench.instances import PlantInstance
from weedlab.phenobench.reader import CROP_CLASSES, PLANT_CLASSES, WEED_CLASSES

IOU_THRESHOLDS = (0.5, 0.3, 0.1)
FOUND_COVERAGE = 0.5
MERGE_COVERAGE = 0.5
SPLIT_COVERAGE = 0.2


@dataclass
class ImageScore:
    references: list[dict]
    detections: list[dict]
    image: dict


def overlap_matrix(pred_labels: np.ndarray, ref_ids: np.ndarray, n_pred: int, ref_index: dict[int, int]) -> np.ndarray:
    """Dense |D ∩ R| counts, shape (n_pred + 1, n_ref + 1); row/col 0 are background."""
    n_ref = len(ref_index)
    ref_idx = np.zeros(pred_labels.shape, dtype=np.int64)
    if n_ref:
        ids = np.array(list(ref_index.keys()), dtype=ref_ids.dtype)
        pos = np.array(list(ref_index.values()), dtype=np.int64)
        lut_order = np.argsort(ids)
        ids_sorted, pos_sorted = ids[lut_order], pos[lut_order]
        where = np.searchsorted(ids_sorted, ref_ids)
        where = np.clip(where, 0, len(ids_sorted) - 1)
        hit = ids_sorted[where] == ref_ids
        ref_idx[hit] = pos_sorted[where[hit]]
    key = pred_labels.astype(np.int64) * (n_ref + 1) + ref_idx
    counts = np.bincount(key.ravel(), minlength=(n_pred + 1) * (n_ref + 1))
    return counts.reshape(n_pred + 1, n_ref + 1)


def score_image(
    pred_labels: np.ndarray,
    n_pred: int,
    pred_records: list[dict],
    semantics: np.ndarray,
    plant_instances: np.ndarray,
    plants: list[PlantInstance],
    ref_lookup: dict[int, dict],
    image_name: str,
) -> ImageScore:
    """ref_lookup: instance_id -> {"category":..., "exclusion":..., "size_band":...} from the frozen table."""
    plants = [p for p in plants if p.kind in ("weed", "crop")]
    ref_index = {p.instance_id: k + 1 for k, p in enumerate(plants)}
    n_ref = len(plants)
    ov = overlap_matrix(pred_labels, plant_instances, n_pred, ref_index)
    pred_area = np.bincount(pred_labels.ravel(), minlength=n_pred + 1).astype(np.int64)
    ref_area = np.array([0] + [p.area_px for p in plants], dtype=np.int64)
    is_weed = np.array([False] + [p.kind == "weed" for p in plants])
    is_crop = ~is_weed.copy()
    is_crop[0] = False

    # IoU and coverage over all (D, R) pairs, D >= 1, R >= 1.
    inter = ov[1:, 1:].astype(np.float64)
    union = pred_area[1:, None] + ref_area[None, 1:] - inter
    iou = np.where(union > 0, inter / np.maximum(union, 1), 0.0)
    coverage = inter / np.maximum(ref_area[None, 1:], 1)

    # Greedy one-to-one matching per threshold, weeds only.
    weed_cols = np.where(is_weed[1:])[0]
    matched_ref: dict[float, dict[int, tuple[int, float]]] = {}
    matched_det: dict[float, dict[int, tuple[int, float]]] = {}
    for tau in IOU_THRESHOLDS:
        mr: dict[int, tuple[int, float]] = {}
        md: dict[int, tuple[int, float]] = {}
        if n_pred and weed_cols.size:
            sub = iou[:, weed_cols]
            cand = np.argwhere(sub >= tau)
            order = np.argsort(-sub[cand[:, 0], cand[:, 1]], kind="stable")
            for di, wi in cand[order]:
                rj = int(weed_cols[wi])
                if di in md or rj in mr:
                    continue
                md[int(di)] = (rj, float(sub[di, wi]))
                mr[rj] = (int(di), float(sub[di, wi]))
        matched_ref[tau], matched_det[tau] = mr, md

    # Per-reference records (weeds only; crops are context).
    refs_out = []
    for rj in weed_cols:
        p = plants[rj]
        info = ref_lookup.get(p.instance_id, {})
        cov = coverage[:, rj] if n_pred else np.zeros(0)
        best_d = int(np.argmax(cov)) if n_pred else -1
        best_cov = float(cov[best_d]) if n_pred else 0.0
        best_iou = float(iou[best_d, rj]) if n_pred else 0.0
        found = best_cov >= FOUND_COVERAGE
        merged_w = merged_c = 0
        if found:
            others = coverage[best_d, :] >= MERGE_COVERAGE
            others[rj] = False
            merged_w = int((others & is_weed[1:]).sum())
            merged_c = int((others & is_crop[1:]).sum())
        n_split = int((cov >= SPLIT_COVERAGE).sum()) if n_pred else 0
        rec = {
            "image": image_name,
            "instance_id": p.instance_id,
            "category": info.get("category") or "",
            "exclusion": info.get("exclusion") or "",
            "size_band": info.get("size_band", ""),
            "area_px": p.area_px,
            "partial": p.partial,
            "best_det": best_d + 1 if n_pred else 0,
            "best_coverage": round(best_cov, 4),
            "best_iou": round(best_iou, 4),
            "found": found,
            "merged_with_weed": merged_w,
            "merged_with_crop": merged_c,
            "n_split": n_split,
            "split": n_split >= 2,
        }
        for tau in IOU_THRESHOLDS:
            m = matched_ref[tau].get(int(rj))
            rec[f"matched@{tau}"] = m is not None
            rec[f"iou@{tau}"] = round(m[1], 4) if m else 0.0
            rec[f"matched_det_area@{tau}"] = int(pred_area[m[0] + 1]) if m else 0
        refs_out.append(rec)

    # Per-detection records.
    crop_px = np.isin(semantics, CROP_CLASSES)
    weed_px = np.isin(semantics, WEED_CLASSES)
    on_crop = np.bincount(pred_labels.ravel(), weights=crop_px.ravel(), minlength=n_pred + 1)
    on_weed = np.bincount(pred_labels.ravel(), weights=weed_px.ravel(), minlength=n_pred + 1)
    dets_out = []
    for r in pred_records:
        k = r["det_id"]
        a = max(1, pred_area[k])
        fc, fw = float(on_crop[k] / a), float(on_weed[k] / a)
        kind = "crop" if fc >= 0.5 else ("weed" if fw >= 0.5 else "background")
        rec = {
            "image": image_name,
            "det_id": k,
            "area_px": int(pred_area[k]),
            "score": r["score"],
            "frac_on_crop": round(fc, 4),
            "frac_on_weed": round(fw, 4),
            "pixel_kind": kind,
            "n_weed_refs_covered": int((coverage[k - 1, :] >= MERGE_COVERAGE)[is_weed[1:]].sum()) if n_ref else 0,
            "n_crop_refs_covered": int((coverage[k - 1, :] >= MERGE_COVERAGE)[is_crop[1:]].sum()) if n_ref else 0,
        }
        for tau in IOU_THRESHOLDS:
            m = matched_det[tau].get(k - 1)
            rec[f"matched@{tau}"] = m is not None
            rec[f"fp_kind@{tau}"] = "" if m else kind
        dets_out.append(rec)

    veg_pred = pred_labels > 0
    plant_px = np.isin(semantics, PLANT_CLASSES)
    inter_p = int((veg_pred & plant_px).sum())
    inter_w = int((veg_pred & weed_px).sum())
    img = {
        "image": image_name,
        "n_ref_weed": int(weed_cols.size),
        "n_ref_crop": int(is_crop.sum()),
        "n_det": n_pred,
        "veg_iou_plants": inter_p / max(1, int((veg_pred | plant_px).sum())),
        "veg_iou_weeds": inter_w / max(1, int((veg_pred | weed_px).sum())),
        "veg_recall_plant_px": inter_p / max(1, int(plant_px.sum())),
        "veg_precision_px": inter_p / max(1, int(veg_pred.sum())),
    }
    for tau in IOU_THRESHOLDS:
        img[f"tp@{tau}"] = len(matched_det[tau])
        img[f"fp@{tau}"] = n_pred - len(matched_det[tau])
        img[f"fn@{tau}"] = int(weed_cols.size) - len(matched_ref[tau])
    return ImageScore(references=refs_out, detections=dets_out, image=img)
