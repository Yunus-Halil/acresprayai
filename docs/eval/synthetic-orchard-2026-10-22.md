# Weed pressure evaluation: synthetic-orchard (2026-10-22)

Grade pressure-v1, crop olive (orchard), action point 10% cover (Turkish ministry: act at 10 to 15% cover (olive, apricot; TAGEM 2022)). Cells 0.50 m, treatment unit 2.5 m, detection floor 12 cm.

Scored 12 of 12 truth quadrats; 0 had less than half their area in assessed cells and are listed, not scored.

## Cover and count against truth

| | Cover | Count |
|---|---|---|
| Mean absolute error | 0.00 points | 0.0 |
| Bias (predicted minus truth) | 0.00 points | 0.0 |
| RMSE | 0.00 points | |

## Act or not, at the action point (10%)

| | Truth: act | Truth: don't act |
|---|---|---|
| Grade: act | 6 | 0 |
| Grade: don't act | 0 | 6 |

Precision 100.0%, recall 100.0%. Patch IoU inside the quadrats 100.0% (the grade's patch cells, 5% over the unit, against quadrats at the action point); with the cells classed at the action point instead, 100.0%.

## Not assessed inside the quadrats

Every cell inside a quadrat was assessed.

## The grade on the whole field

3448 of 4800 cells assessed; field cover 1.4% (low); 189 cells at the action point or over; 377 confirmed, 399 possible; 6 patches; 0 large escapes; 0 cells where pixels and objects disagree.

## Per quadrat

| Quadrat | Side | Assessed | Truth cover | Predicted | Truth count | Predicted | Truth acts | Grade acts |
|---|---|---|---|---|---|---|---|---|
| p1 | 1.01 m | 100% | 13.5% | 13.5% | 4 | 4.0 | yes | yes |
| p2 | 1.01 m | 100% | 2.8% | 2.8% | 1 | 1.0 | no | no |
| p3 | 1.01 m | 100% | 0.0% | 0.0% | 0 | 0.0 | no | no |
| p4 | 1.01 m | 100% | 14.9% | 14.9% | 4 | 4.0 | yes | yes |
| p5 | 1.01 m | 100% | 2.8% | 2.8% | 1 | 1.0 | no | no |
| p6 | 1.01 m | 100% | 16.0% | 16.0% | 6 | 6.0 | yes | yes |
| p7 | 1.01 m | 100% | 0.0% | 0.0% | 0 | 0.0 | no | no |
| p8 | 1.01 m | 100% | 11.1% | 11.1% | 4 | 4.0 | yes | yes |
| p9 | 1.01 m | 100% | 35.3% | 35.3% | 16 | 16.0 | yes | yes |
| p10 | 1.01 m | 100% | 2.8% | 2.8% | 1 | 1.0 | no | no |
| p11 | 1.01 m | 100% | 0.0% | 0.0% | 0 | 0.0 | no | no |
| p12 | 1.01 m | 100% | 14.9% | 14.9% | 4 | 4.0 | yes | yes |

Cover is weed over the visible ground (imaged, off the crop row band and crowns), as the grade reads it. These numbers are only as good as the truth file: say how it was made beside them.
