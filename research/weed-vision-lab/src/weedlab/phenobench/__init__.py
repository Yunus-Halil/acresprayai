"""PhenoBench v1.1.0 reader, validation and instance extraction.

The format as read from the extracted archive on 2026-10-13 (and checked against
the MIT-licensed devkit `phenobench==0.1.0`):

  <root>/{train,val}/images/<name>.png            RGB, uint8, 1024 x 1024
  <root>/{train,val}/semantics/<name>.png         uint16 (PIL mode I;16), values 0..4
  <root>/{train,val}/plant_instances/<name>.png   uint16, 0 = none, id > 0 = one plant
  <root>/{train,val}/leaf_instances/<name>.png    uint16, 0 = none, id > 0 = one leaf
  <root>/{train,val}/plant_visibility/<name>.png  uint8 (PIL mode L), 0..255, 255 = fully visible
  <root>/{train,val}/leaf_visibility/<name>.png   uint8, same scale
  <root>/test/images/<name>.png                   RGB only, no labels published

Semantic ids: 0 background, 1 crop, 2 weed, 3 partial crop, 4 partial weed.
The dataset README lists id 4 as "partial-crop" a second time; the devkit maps
3 -> crop and 4 -> weed, which is what this reader follows.

Note the visibility masks are 8-bit although the README says all annotations
are 16-bit. The reader keeps whatever dtype the file holds and never rescales.
"""
