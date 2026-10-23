# Crop profile benchmark: synthetic (corn)

Run 2026-10-23, code c28f705+uncommitted, 80 development scenes (seeds 1000+ and the first evaluation set, seeds 2000+, which became development data when it prompted the ExGR gate), rendered by scripts/cropProfiles/scenes.ts. Synthetic: it tests the engine against known geometry and known failure conditions, not field accuracy.

Correct rows: found, at least three quarters of the row lines within a quarter pitch of a true row, pitch within 5%. Wrong rows: found, and not correct. Off-row precision and recall: blobs the pass calls off-row against the weeds rendered between the rows (matched within 1.5 radii or 6 cm).

| Group | Mode | Scenes | Rows found | Correct rows | Wrong rows | Median pitch error | Median angle error (deg) | Lines on the crop | Scenes with every line on the crop | Off-row precision | Off-row recall |
|---|---|---|---|---|---|---|---|---|---|---|---|
| all | neutral | 80 | 0.963 | 0.813 | 0.15 | 0.001 | 0.05 | 0.871 | 0.813 | 0.859 | 0.43 |
| all | corn | 80 | 0.938 | 0.888 | 0.05 | 0.001 | 0.057 | 0.973 | 0.888 | 0.947 | 0.507 |
| straw stripes | neutral | 42 | 0.976 | 0.762 | 0.214 | 0.001 | 0.05 | 0.792 | 0.762 | 0.791 | 0.378 |
| straw stripes | corn | 42 | 0.929 | 0.881 | 0.048 | 0.001 | 0.058 | 0.974 | 0.881 | 0.957 | 0.515 |
| no straw | neutral | 38 | 0.947 | 0.868 | 0.079 | 0.001 | 0.05 | 0.961 | 0.868 | 0.925 | 0.49 |
| no straw | corn | 38 | 0.947 | 0.895 | 0.053 | 0.001 | 0.05 | 0.972 | 0.895 | 0.936 | 0.499 |
| small photo (under 7.5 m) | neutral | 41 | 0.951 | 0.829 | 0.122 | 0.002 | 0.1 | 0.899 | 0.829 | 0.911 | 0.389 |
| small photo (under 7.5 m) | corn | 41 | 0.902 | 0.854 | 0.049 | 0.002 | 0.15 | 0.972 | 0.854 | 0.972 | 0.417 |
| twin rows | neutral | 10 | 1 | 0.6 | 0.4 | 0.004 | 0.057 | 0.746 | 0.6 | 0.751 | 0.122 |
| twin rows | corn | 10 | 1 | 0.6 | 0.4 | 0.005 | 0.092 | 0.797 | 0.6 | 0.801 | 0.136 |
| red soil | neutral | 29 | 1 | 0.69 | 0.31 | 0.001 | 0.068 | 0.71 | 0.69 | 0.732 | 0.293 |
| red soil | corn | 29 | 0.897 | 0.862 | 0.034 | 0.001 | 0.1 | 0.981 | 0.862 | 0.997 | 0.468 |
| gsd 2 to 3 cm | neutral | 29 | 0.966 | 0.897 | 0.069 | 0.001 | 0.05 | 0.946 | 0.897 | 0.887 | 0.483 |
| gsd 2 to 3 cm | corn | 29 | 0.966 | 0.931 | 0.034 | 0.001 | 0.05 | 0.982 | 0.931 | 0.934 | 0.483 |
