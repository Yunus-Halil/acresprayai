# Roadmap

Things decided as worth doing and not started. Each entry says who asked, when, and what is known. Nothing here is
built; an entry is not a commitment to a date.

## Control points supplied by the user

Asked by the founder, 2026-11-25.

A Field Twin is placed on the map by the drone's own position record. Without RTK that puts the whole twin some
distance from where the field really is (the figure measured on a public trial is in the day's report; it is the twin's
raw placement accuracy). Research trials are often laid out with surveyed targets on the ground, and their plot
outlines are given in the survey's coordinates.

The feature: the user gives the surveyed positions of their targets (a file of identifier, easting, northing, or
latitude and longitude); the build finds each target in the photographs, sees where the twin puts it, and moves the
twin onto the survey (a shift, and a small turn and stretch where the points allow). Plot outlines the user brings
then line up with the plants, and counts can be reported per plot.

What is known from doing it by hand on a public trial (College Station 2017, 12 surveyed points): see the report of
2026-11-25 in the research notes for how well the points agreed after the fit and how far the twin sat off before it.

Open: finding the targets without a person (they differ from trial to trial); what to do with fewer than three points;
whether RTK flights need it at all; how the user draws or uploads plot outlines.

## Build time and memory on larger flights

Noted by the founder, 2026-11-25 ("becoming a real problem too").

Measured in Chrome on this computer: 150 photographs of 20 megapixels took 792 s and 2.95 GB at peak; 123 photographs
of another flight took 176 s and 2.65 GB. The difference is the corn stage: 8.7 s a photograph to read against 2.5 s,
and about five minutes combining the photographs over the field. Not investigated further.
