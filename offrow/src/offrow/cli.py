"""Command line interface.

Only ``offrow sensor`` does anything yet. The rest are declared so the shape of
the tool is visible and so nothing quietly invents a different interface later.
"""

from __future__ import annotations

from pathlib import Path

import typer

from offrow import __version__
from offrow import sensor as sensor_mod

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Off-row vegetation detection in early-season corn from RGB drone imagery.",
)

DEFAULT_ALTITUDES = "10,20,30,60,120"


def _parse_floats(raw: str, what: str) -> list[float]:
    try:
        return [float(part) for part in raw.split(",") if part.strip()]
    except ValueError as exc:
        raise typer.BadParameter(f"{what} must be a comma-separated list of numbers") from exc


def _not_built(step: str) -> None:
    typer.secho(f"Not implemented yet: {step}.", fg=typer.colors.YELLOW, err=True)
    raise typer.Exit(code=2)


@app.callback()
def _main(
    version: bool = typer.Option(False, "--version", help="Print the version and exit."),
) -> None:
    if version:
        typer.echo(__version__)
        raise typer.Exit()


@app.command()
def sensor(
    sensor_mm: float = typer.Option(13.2, "--sensor-mm", help="Sensor width in millimetres."),
    px: int = typer.Option(8192, "--px", help="Pixels across the sensor width."),
    focal_mm: float = typer.Option(8.8, "--focal-mm", help="True focal length in millimetres."),
    height_mm: float = typer.Option(
        None, "--height-mm", help="Along-track sensor height. Defaults to 4:3 of the width."
    ),
    alt: str = typer.Option(
        DEFAULT_ALTITUDES, "--alt", help="Altitude in metres, or a comma-separated ladder."
    ),
    from_catalog: str = typer.Option(
        None, "--catalog", help="Use a named candidate airframe instead of the explicit geometry."
    ),
    target_gsd_mm: float = typer.Option(
        None, "--target-gsd-mm", help="Solve for the altitude that achieves this GSD."
    ),
    weed_cm: float = typer.Option(
        3.0, "--weed-cm", help="Target object size for the pixel column."
    ),
    ref_alt: float = typer.Option(
        sensor_mod.DEFAULT_REFERENCE_ALTITUDE_M,
        "--ref-alt",
        help="Altitude costs are quoted against.",
    ),
    cruise: float = typer.Option(15.0, "--cruise", help="Cruise ground speed, m/s."),
    frame_interval: float = typer.Option(
        1.0, "--frame-interval", help="Shortest interval between captures, seconds."
    ),
    frontlap: float = typer.Option(0.75, "--frontlap", help="Along-track overlap fraction."),
    sidelap: float = typer.Option(0.65, "--sidelap", help="Across-track overlap fraction."),
    duty: float = typer.Option(
        0.55, "--duty", help="Fraction of wall-clock on survey lines, after turns and swaps."
    ),
    list_sensors: bool = typer.Option(False, "--list", help="List candidate airframes and exit."),
) -> None:
    """Ground sample distance, swath, and what flying lower costs."""
    if list_sensors:
        for key, cam in sensor_mod.CATALOG.items():
            typer.echo(
                f"{key:<18} {cam.sensor_width_mm:>5.1f} mm  {cam.pixels_across:>6} px  "
                f"{cam.focal_length_mm:>5.2f} mm  {cam.pixel_pitch_um:.2f} um/px"
            )
            typer.echo(f"{'':<18} {cam.note}")
        raise typer.Exit()

    if from_catalog:
        if from_catalog not in sensor_mod.CATALOG:
            raise typer.BadParameter(
                f"unknown airframe {from_catalog!r}; try --list", param_hint="--catalog"
            )
        cam = sensor_mod.CATALOG[from_catalog]
    else:
        cam = sensor_mod.Sensor(
            name="custom",
            sensor_width_mm=sensor_mm,
            pixels_across=px,
            focal_length_mm=focal_mm,
            sensor_height_mm=height_mm,
            note="Supplied on the command line.",
        )

    profile = sensor_mod.MissionProfile(
        cruise_speed_ms=cruise,
        frame_interval_s=frame_interval,
        frontlap=frontlap,
        sidelap=sidelap,
        duty_cycle=duty,
    )

    typer.echo(
        f"{cam.name}: {cam.sensor_width_mm} mm / {cam.pixels_across} px / {cam.focal_length_mm} mm"
    )
    typer.echo(
        f"pixel pitch {cam.pixel_pitch_um:.2f} um, "
        f"swath {cam.field_of_view_ratio:.3f} m and along-track {cam.along_track_ratio:.3f} m "
        "per m of altitude"
    )
    if cam.note:
        typer.echo(f"note: {cam.note}")
    typer.echo("")

    crossover = sensor_mod.crossover_altitude_m(cam, profile)
    typer.secho(f"Crossover altitude: {crossover:.1f} m", fg=typer.colors.GREEN, bold=True)
    typer.echo(
        f"  above it the aircraft cruises at {cruise:g} m/s and coverage falls off linearly "
        "as you descend;"
    )
    typer.echo(
        f"  below it the {frame_interval:g} s frame interval binds at {frontlap:.0%} frontlap "
        "and the fall-off goes quadratic."
    )
    typer.echo("")

    if target_gsd_mm is not None:
        altitude = sensor_mod.altitude_for_gsd_m(cam, target_gsd_mm)
        typer.echo(f"{target_gsd_mm:g} mm/px needs {altitude:.1f} m altitude")
        typer.echo("")

    plans = sensor_mod.altitude_ladder(
        cam,
        _parse_floats(alt, "--alt"),
        profile=profile,
        reference_altitude_m=ref_alt,
        target_object_mm=weed_cm * 10.0,
    )
    typer.echo(sensor_mod.format_table(plans))
    typer.echo("")
    typer.echo(
        f"Theoretical acres/hour is survey-line time only. Effective applies a {duty:.0%} duty "
        f"cycle for turns, transit and battery swaps, and assumes {sidelap:.0%} sidelap."
    )
    typer.echo(
        "Flight-count ratios are geometry and survive; both acres/hour columns are only as "
        "good as the cruise speed, frame interval and duty cycle above."
    )
    typer.echo(
        f"Roughly {sensor_mod.DETECTION_FLOOR_PX:g} px across is the floor for detecting a blob, "
        f"{sensor_mod.SHAPE_FLOOR_PX:g} px is where leaf shape becomes usable."
    )


@app.command()
def fetch(
    dataset: str = typer.Option(..., "--dataset", help="droneweed | usu-corn-weeddb"),
    subset: str = typer.Option(None, "--subset", help="Source-specific subset, e.g. maize."),
    out: Path = typer.Option(Path("data"), "--out", help="Cache directory. Gitignored."),
) -> None:
    """Download a public dataset into the local cache."""
    _not_built("offrow fetch (datasets.py)")


@app.command()
def synth(
    out: Path = typer.Option(..., "--out", help="Output directory."),
    gsd_mm: float = typer.Option(5.5, "--gsd-mm", help="Render resolution."),
    acres: float = typer.Option(2.0, "--acres", help="Field size."),
    row_spacing_in: float = typer.Option(30.0, "--row-spacing-in", help="Planted row spacing."),
    weed_density: float = typer.Option(3.0, "--weed-density", help="Weeds per 10 square metres."),
    shadows: bool = typer.Option(False, "--shadows", help="Cast directional plant shadows."),
    wheel_tracks: bool = typer.Option(False, "--wheel-tracks", help="Draw wheel tracks."),
    wet_patches: bool = typer.Option(False, "--wet-patches", help="Draw wet soil patches."),
    seed: int = typer.Option(0, "--seed", help="Reproducibility."),
) -> None:
    """Render a synthetic field with exact ground truth."""
    _not_built("offrow synth (synth.py)")


@app.command()
def detect(
    ortho: Path = typer.Option(..., "--ortho", help="Orthomosaic to process."),
    boundary: Path = typer.Option(..., "--boundary", help="Field boundary GeoJSON."),
    row_spacing_in: float = typer.Option(
        ..., "--row-spacing-in", help="Row spacing the grower planted."
    ),
    out: Path = typer.Option(..., "--out", help="Candidate GeoJSON to write."),
    headland_m: float = typer.Option(15.0, "--headland-m", help="Inward boundary buffer."),
    exclude: Path = typer.Option(None, "--exclude", help="Extra exclusion polygons."),
) -> None:
    """Find off-row candidates. Produces a review queue, never a verdict."""
    _not_built("offrow detect (io.py, vegetation.py, rows.py, blobs.py, candidates.py)")


@app.command()
def grid(
    candidates: Path = typer.Option(..., "--candidates", help="Candidate GeoJSON from detect."),
    cell_m: float = typer.Option(10.0, "--cell-m", help="Review cell edge length."),
    out: Path = typer.Option(..., "--out", help="Review grid GeoJSON to write."),
) -> None:
    """Aggregate candidates into review cells ranked by worst candidate."""
    _not_built("offrow grid (grid.py)")


@app.command(name="eval")
def eval_(
    pred: Path = typer.Option(..., "--pred", help="Predicted candidates."),
    truth: Path = typer.Option(..., "--truth", help="Ground truth points."),
    out: Path = typer.Option(..., "--out", help="Curve image to write."),
    tolerance_m: float = typer.Option(0.25, "--tolerance-m", help="Centroid match tolerance."),
) -> None:
    """Recall against a false-positives-per-acre budget."""
    _not_built("offrow eval (eval.py)")


@app.command(name="gsd-sweep")
def gsd_sweep(
    scene: Path = typer.Option(..., "--scene", help="Scene or dataset directory."),
    gsds_mm: str = typer.Option("1.7,2.7,5.5,11,22", "--gsds-mm", help="Simulated GSD ladder."),
    out: Path = typer.Option(..., "--out", help="Plot to write."),
    row_spacing_in: float = typer.Option(30.0, "--row-spacing-in", help="Row spacing."),
) -> None:
    """Recall against GSD, with row-model confidence alongside it."""
    _not_built("offrow gsd-sweep (altitude.py, eval.py)")


if __name__ == "__main__":
    app()
