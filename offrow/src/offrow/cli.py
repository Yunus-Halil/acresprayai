"""Command line interface.

Only ``offrow sensor`` does anything yet. The rest are declared so the shape of
the tool is visible and so nothing quietly invents a different interface later.
"""

from __future__ import annotations

from pathlib import Path

import typer

from offrow import __version__
from offrow import datasets as datasets_mod
from offrow import sensor as sensor_mod
from offrow import synth as synth_mod

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
    force: bool = typer.Option(False, "--force", help="Re-download even if cached."),
) -> None:
    """Download a public dataset into the local cache."""
    try:
        target = datasets_mod.fetch(dataset, subset=subset, root=out, force=force)
    except datasets_mod.DatasetUnavailable as exc:
        typer.secho(str(exc), fg=typer.colors.YELLOW, err=True)
        raise typer.Exit(code=3) from exc
    except KeyError as exc:
        raise typer.BadParameter(str(exc), param_hint="--dataset") from exc
    typer.echo(f"ready: {target}")


@app.command()
def inspect(
    dataset: str = typer.Option(..., "--dataset", help="droneweed | usu-corn-weeddb"),
    subset: str = typer.Option("maize", "--subset", help="Source-specific subset."),
    root: Path = typer.Option(Path("data"), "--root", help="Cache directory."),
    row_spacing_in: float = typer.Option(
        29.5, "--row-spacing-in", help="Planted row spacing to judge row-fit against."
    ),
    samples: int = typer.Option(0, "--samples", help="Render this many frames with boxes drawn."),
    out: Path = typer.Option(Path("out/samples"), "--out", help="Where to write sample frames."),
    limit: int = typer.Option(0, "--limit", help="Only load this many frames. 0 loads all."),
    mosaic: bool = typer.Option(
        False, "--mosaic", help="Reassemble tiles into their source frames and report that too."
    ),
    complete: bool = typer.Option(
        False, "--complete", help="Fill mosaic gaps with unlabelled tiles. USU only."
    ),
) -> None:
    """Ground coverage per frame, and whether it spans enough rows for a row model.

    The question that decides where rows.py can run: on a frame, on a stitched
    strip, or only on a real orthomosaic.
    """
    spacing_m = row_spacing_in * 0.0254

    if dataset in datasets_mod.SPECS:
        spec = datasets_mod.SPECS[dataset]
        if spec.tile_coverage_m:
            typer.secho("From the published descriptor, before loading a byte:", bold=True)
            typer.echo(f"  {datasets_mod.spec_feasibility(dataset, spacing_m)}")
            typer.echo("")

    try:
        data = datasets_mod.load(dataset, root=root, subset=subset)
    except datasets_mod.DatasetUnavailable as exc:
        typer.secho(str(exc), fg=typer.colors.YELLOW, err=True)
        raise typer.Exit(code=3) from exc

    if limit:
        data.frames = data.frames[:limit]
    typer.echo(datasets_mod.coverage_report(data, spacing_m))

    if samples and data.frames:
        typer.echo("")
        ranked = sorted(data.frames, key=lambda f: -len(f.annotations))[:samples]
        for i, frame in enumerate(ranked):
            width_m, _ = frame.coverage_m
            path = datasets_mod.draw_boxes(
                frame,
                out / f"{dataset}_tile_{i:02d}.png",
                scale_bar_m=0.5,
                title=(
                    f"{frame.image_path.name}  |  {width_m:.2f} m  |  "
                    f"{width_m / spacing_m:.1f} rows"
                ),
            )
            typer.echo(f"  wrote {path}")

    if not mosaic:
        return

    groups = datasets_mod.group_tiles(data)
    typer.echo("")
    if not groups:
        typer.secho(
            "  No tile origins in these filenames, so the tiles cannot be reassembled.\n"
            "  Check whether the VOC path field kept the original partition name; if it did\n"
            "  not, this dataset can exercise the vegetation mask but never the row model.",
            fg=typer.colors.YELLOW,
        )
        return

    unlabelled = None
    if complete:
        try:
            unlabelled = datasets_mod.load_usu_unlabelled_tiles(root=root)
        except datasets_mod.DatasetUnavailable as exc:
            typer.secho(f"  no unlabelled tiles: {exc}", fg=typer.colors.YELLOW)

    mosaics = []
    for source_id in groups:
        try:
            mosaics.append(datasets_mod.stitch_complete(source_id, data, unlabelled))
        except ValueError:
            continue

    summary = datasets_mod.mosaic_coverage_summary(mosaics)
    typer.secho(f"  reassembled into {len(mosaics)} source frames", bold=True)
    typer.echo(
        f"  mosaic coverage: {summary['width_m_median']:.1f} x "
        f"{summary['height_m_median']:.1f} m median, "
        f"{summary['tiles_per_mosaic_median']:.0f} tiles each"
    )
    typer.echo(
        f"  row fit: {datasets_mod.row_fit_feasibility(summary['short_edge_m_median'], spacing_m)}"
    )

    if samples and mosaics:
        biggest = sorted(mosaics, key=lambda m: -m.coverage_m2)[:samples]
        for i, m in enumerate(biggest):
            covered = 100 * m.truth_footprint_m2 / m.coverage_m2 if m.coverage_m2 else 0.0
            path = datasets_mod.draw_boxes(
                m,
                out / f"{dataset}_mosaic_{i:02d}.png",
                scale_bar_m=2.0,
                title=(
                    f"{m.source_id}: {len(m.tiles)} tiles  |  "
                    f"{m.coverage_m[0]:.1f} x {m.coverage_m[1]:.1f} m  |  "
                    f"{m.min_coverage_m / spacing_m:.0f} rows  |  "
                    f"truth covers {covered:.0f}%"
                ),
            )
            typer.echo(f"  wrote {path}")


@app.command()
def synth(
    out: Path = typer.Option(Path("data/synth"), "--out", help="Output directory."),
    name: str = typer.Option("scene", "--name", help="Basename for the written files."),
    gsd_mm: float = typer.Option(5.5, "--gsd-mm", help="Render resolution."),
    acres: float = typer.Option(2.0, "--acres", help="Field size."),
    width_m: float = typer.Option(None, "--width-m", help="Explicit width, overrides --acres."),
    height_m: float = typer.Option(None, "--height-m", help="Explicit height, overrides --acres."),
    row_spacing_in: float = typer.Option(30.0, "--row-spacing-in", help="Planted row spacing."),
    row_angle_deg: float = typer.Option(0.0, "--row-angle", help="Row direction in degrees."),
    inrow_spacing_m: float = typer.Option(0.15, "--inrow-m", help="Within-row plant spacing."),
    jitter: float = typer.Option(0.10, "--jitter", help="Spacing jitter as a fraction."),
    skip_rate: float = typer.Option(0.05, "--skip-rate", help="Fraction of plant positions empty."),
    crop_cm: float = typer.Option(12.0, "--crop-cm", help="Crop canopy diameter."),
    weed_density: float = typer.Option(0.3, "--weed-density", help="Weeds per square metre."),
    weed_cm: float = typer.Option(
        3.0, "--weed-cm", help="Mean weed diameter. Defaults to the flight-spec target."
    ),
    offrow_bias: float = typer.Option(
        0.5, "--offrow-bias", help="0 uniform, 1 all at the inter-row midpoint."
    ),
    shadows: bool = typer.Option(False, "--shadows", help="Cast directional plant shadows."),
    sun_azimuth: float = typer.Option(135.0, "--sun-azimuth", help="Shadow direction."),
    sun_elevation: float = typer.Option(40.0, "--sun-elevation", help="Sun height."),
    wheel_tracks: bool = typer.Option(False, "--wheel-tracks", help="Draw wheel tracks."),
    wet_patches: bool = typer.Option(False, "--wet-patches", help="Draw wet soil patches."),
    seed: int = typer.Option(0, "--seed", help="Reproducibility."),
    ladder_mm: str = typer.Option(
        None, "--ladder-mm", help="Also render this comma-separated GSD ladder as a figure."
    ),
    ladder_extent_m: float = typer.Option(
        None, "--ladder-extent-m", help="Ground extent shown per ladder panel."
    ),
    no_raster: bool = typer.Option(
        False, "--no-raster", help="Write truth and manifest only, skip the GeoTIFF."
    ),
) -> None:
    """Render a synthetic field with exact ground truth.

    The only place the hard regime gets tested: the public sets contain no weed
    under 8 cm, and the flight spec targets 3 cm.
    """
    params = synth_mod.SceneParams(
        acres=acres,
        width_m=width_m,
        height_m=height_m,
        row_spacing_m=row_spacing_in * 0.0254,
        row_angle_deg=row_angle_deg,
        inrow_spacing_m=inrow_spacing_m,
        spacing_jitter_frac=jitter,
        skip_rate=skip_rate,
        crop_diameter_m=crop_cm / 100.0,
        weed_density_per_m2=weed_density,
        weed_diameter_m=weed_cm / 100.0,
        weed_offrow_bias=offrow_bias,
        shadows=shadows,
        sun_azimuth_deg=sun_azimuth,
        sun_elevation_deg=sun_elevation,
        wheel_tracks=wheel_tracks,
        wet_patches=wet_patches,
        seed=seed,
    )
    scene = synth_mod.generate(params)

    typer.secho(
        f"{scene.extent_m[0]:.1f} x {scene.extent_m[1]:.1f} m "
        f"({scene.area_acres:.2f} acres) at {gsd_mm:g} mm/px",
        bold=True,
    )
    typer.echo(
        f"  {len(scene.crop_xy_m)} crop plants, {len(scene.weed_xy_m)} weeds, "
        f"{int(scene.offrow_mask.sum())} of them off-row"
    )
    typer.echo(f"  {scene.min_coverage_rows(params.row_spacing_m):.0f} rows across the short edge")
    typer.echo("  ground truth by weed diameter:")
    histogram = scene.diameter_histogram()
    total = max(sum(histogram.values()), 1)
    for index, (label, count) in enumerate(histogram.items()):
        flag = "  <- the flight-spec bin" if index == datasets_mod.FLIGHT_SPEC_BIN else ""
        typer.echo(f"    {label:<12} {count:>7}  {100 * count / total:5.1f}%{flag}")

    if not no_raster:
        written = synth_mod.write_scene(scene, out, gsd_mm, name=name)
    else:
        out.mkdir(parents=True, exist_ok=True)
        written = {
            "truth": scene.truth_geojson(out / f"{name}_truth.geojson"),
            "crop": scene.crop_geojson(out / f"{name}_crop.geojson"),
            "boundary": scene.boundary_geojson(out / f"{name}_boundary.geojson"),
        }
    typer.echo("")
    for kind, path in written.items():
        typer.echo(f"  {kind:<9} {path}")
    if not no_raster and synth_mod.last_raster_backend() == "tifffile":
        typer.secho(
            "  raster written as a tiled TIFF plus .tfw/.prj world files: rasterio could "
            "not load on this machine, so a true GeoTIFF was not written.",
            fg=typer.colors.YELLOW,
        )

    if ladder_mm:
        gsds = _parse_floats(ladder_mm, "--ladder-mm")
        figure = synth_mod.degradation_figure(
            scene, gsds, out / f"{name}_ladder.png", extent_m=ladder_extent_m
        )
        typer.echo(f"  ladder    {figure}")

    typer.secho(
        "\n  Synthetic. Drives development and tests. Never a reportable accuracy number.",
        fg=typer.colors.YELLOW,
    )


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
