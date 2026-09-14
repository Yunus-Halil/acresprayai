"""Simulating higher-altitude capture from lower-altitude imagery.

STUB. No implementation yet.

The point of this module is the question the repo exists to answer: at what
ground sample distance does off-row detection stop working? Published methods
that work were flown around 1 to 2 mm/px; operators fly at 2 cm/px. Nobody needs
a new flight to probe the middle of that gap, only honest degradation.

Honest means not plain decimation. Flying higher degrades the optical transfer
function as well as the sampling rate, and decimation alone models only the
sampling, which makes high altitudes look better than they are. Blur with a PSF
whose sigma scales with the altitude ratio, then decimate, then optionally add
sensor noise.

The PSF model is an approximation and is exposed as a parameter so it can be
argued with. Every curve this module feeds must be labelled simulated, never
reported as flown.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class DegradationModel:
    """Parameters of the simulated optical and sensor degradation.

    Args:
        psf_sigma_px: Gaussian PSF sigma at the *target* sampling, in target
            pixels, before the altitude ratio is applied. A value near 0.5 keeps
            the blur just under the Nyquist limit of the new grid.
        psf_model: Which approximation is in use. Recorded so results carry their
            assumption rather than implying a measured OTF.
        read_noise_sigma: Additive Gaussian noise sigma in DN, applied after
            decimation. Zero disables it.
        shot_noise: Whether to add Poisson shot noise scaled by signal.
    """

    psf_sigma_px: float = 0.5
    psf_model: str = "gaussian-approximation"
    read_noise_sigma: float = 0.0
    shot_noise: bool = False


def psf_sigma_for_ratio(ratio: float, model: DegradationModel) -> float:
    """PSF sigma in *source* pixels for an altitude ratio of ``ratio``.

    Args:
        ratio: target_gsd / source_gsd. Always >= 1; this module simulates
            flying higher, never lower.
        model: Degradation parameters.

    Returns:
        Sigma in source-image pixels to blur with before decimating.

    Raises:
        ValueError: If ``ratio`` is below 1. Sharpening imagery to fake a lower
            altitude would invent detail, and this module will not do it.
    """
    raise NotImplementedError


def degrade(
    image: np.ndarray,
    source_gsd_mm: float,
    target_gsd_mm: float,
    model: DegradationModel | None = None,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Simulate ``image`` as it would have been captured at a coarser GSD.

    Blur with the scaled PSF, then decimate by the GSD ratio, then apply noise.
    In that order: decimating first would alias the detail the PSF is supposed
    to have removed.

    Args:
        image: HxW or HxWxC array. Dtype is preserved on return.
        source_gsd_mm: GSD of ``image``, millimetres per pixel.
        target_gsd_mm: GSD to simulate. Must be >= ``source_gsd_mm``.
        model: Degradation parameters. Defaults to :class:`DegradationModel`.
        rng: Source of randomness for the noise terms, for reproducible runs.

    Returns:
        The degraded image, shape scaled by ``source_gsd_mm / target_gsd_mm``.
    """
    raise NotImplementedError


def ladder(
    image: np.ndarray,
    source_gsd_mm: float,
    target_gsds_mm: list[float],
    model: DegradationModel | None = None,
    rng: np.random.Generator | None = None,
) -> list[tuple[float, np.ndarray]]:
    """Degrade one image to each GSD in ``target_gsds_mm``.

    Each rung is degraded from the original, never from the rung below it, so
    blur does not compound down the ladder.

    Returns:
        ``(gsd_mm, array)`` pairs in the order requested. The GSD travels with
        the array because a result without a GSD attached is not a result.
    """
    raise NotImplementedError


def mask_area_agreement(
    mask_a: np.ndarray, gsd_a_mm: float, mask_b: np.ndarray, gsd_b_mm: float
) -> float:
    """Relative difference in ground area between two masks at different GSDs.

    The cross-validation the degradation model lives or dies by: a scene
    degraded from fine to coarse should produce nearly the same vegetated ground
    area as the same scene rendered natively at the coarse GSD. If these
    diverge, every altitude number downstream is wrong.

    Returns:
        ``abs(area_a - area_b) / area_b``, dimensionless.
    """
    raise NotImplementedError
