# Crop profile benchmark: synthetic (corn)

Run 2026-10-23, code bdedeb7, 60 evaluation scenes (seeds 3000+, run once after the last change to the profile), rendered by scripts/cropProfiles/scenes.ts. Synthetic: it tests the engine against known geometry and known failure conditions, not field accuracy.

Correct rows: found, at least three quarters of the row lines within a quarter pitch of a true row, pitch within 5%. Wrong rows: found, and not correct. Off-row precision and recall: blobs the pass calls off-row against the weeds rendered between the rows (matched within 1.5 radii or 6 cm).

| Group | Mode | Scenes | Rows found | Correct rows | Wrong rows | Median pitch error | Median angle error (deg) | Lines on the crop | Scenes with every line on the crop | Off-row precision | Off-row recall |
|---|---|---|---|---|---|---|---|---|---|---|---|
| all | neutral | 60 | 1 | 0.783 | 0.217 | 0.001 | 0.05 | 0.821 | 0.783 | 0.694 | 0.432 |
| all | corn | 60 | 0.983 | 0.9 | 0.083 | 0.001 | 0.042 | 0.95 | 0.9 | 0.848 | 0.507 |
| straw stripes | neutral | 25 | 1 | 0.56 | 0.44 | 0.001 | 0.045 | 0.594 | 0.56 | 0.444 | 0.248 |
| straw stripes | corn | 25 | 1 | 0.8 | 0.2 | 0.001 | 0.042 | 0.882 | 0.8 | 0.728 | 0.438 |
| no straw | neutral | 35 | 1 | 0.943 | 0.057 | 0.002 | 0.05 | 0.983 | 0.943 | 0.855 | 0.535 |
| no straw | corn | 35 | 0.971 | 0.971 | 0 | 0.002 | 0.049 | 1 | 0.971 | 0.915 | 0.545 |
| small photo (under 7.5 m) | neutral | 29 | 1 | 0.793 | 0.207 | 0.002 | 0.1 | 0.841 | 0.793 | 0.761 | 0.406 |
| small photo (under 7.5 m) | corn | 29 | 0.966 | 0.931 | 0.034 | 0.002 | 0.2 | 0.981 | 0.931 | 0.944 | 0.467 |
| twin rows | neutral | 7 | 1 | 0.714 | 0.286 | 0.002 | 0.05 | 0.786 | 0.714 | 0.72 | 0.179 |
| twin rows | corn | 7 | 1 | 0.714 | 0.286 | 0.004 | 0.033 | 0.853 | 0.714 | 0.72 | 0.179 |
| red soil | neutral | 25 | 1 | 0.64 | 0.36 | 0.001 | 0.05 | 0.64 | 0.64 | 0.412 | 0.251 |
| red soil | corn | 25 | 1 | 0.88 | 0.12 | 0.001 | 0.033 | 0.919 | 0.88 | 0.709 | 0.472 |
| gsd 2 to 3 cm | neutral | 24 | 1 | 0.792 | 0.208 | 0.001 | 0.05 | 0.844 | 0.792 | 0.688 | 0.464 |
| gsd 2 to 3 cm | corn | 24 | 1 | 0.958 | 0.042 | 0.001 | 0.033 | 0.983 | 0.958 | 0.868 | 0.541 |
