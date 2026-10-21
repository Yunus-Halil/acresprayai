# Taranis, studied as the incumbent: what it does, where it is weak, what Swardus inverts (2026-10-21)

Three web sweeps on 2026-10-21: product, technology and patents; business model and customer-reported weaknesses;
rivals, the sampling-versus-coverage evidence, grower-owned-drone rules and the open ground. Every claim carries its
source; "not found" means the searches came up empty. Inference is marked.

## In one paragraph

Taranis (Westfield, Indiana; founded 2015 in Tel Aviv; about $100M raised, last round Series D $40M in September 2022)
sells "leaf-level" crop scouting through US ag retailers for corn and soybean. Its own pilots fly DJI M300/M30 drones
on a fixed growth-stage cadence of four to six missions a season, capture sub-millimetre frames at sample points, run
cloud AI on them, and deliver boxed detections, interpolated stand counts, weed and disease flags, generative
recommendations and, since May 2026, a corn-only yield-loss estimate. It is a sampling service, not a mapping product.
It closed Brazil in July 2025 to focus on the US, has raised nothing since 2022, lists only sales and customer-success
roles, and anonymous former staff describe a workforce cut of about half between 2023 and 2025.

## What they do (verified)

| Fact | Source |
|---|---|
| Service agreement: AI insights within 72 h of acquisition; a minimum of one leaf-level image per 2 acres; a flight counts as successful at ≥ 80% of the accessible field | taranis.com/sla |
| Each leaf-level frame covers about 1/25 acre, the wide-angle frame about 1/8 acre; pilots fly 750–1,000 acres a day | farms.com Precision Ag Digest, Spring 2026 |
| Inference: about 1.5 frames per acre × 1/25 acre ≈ 6% of the ground seen at leaf level; marketing says "every acre is captured" | taranis.com blog "One acre, one image", 2024-03-15 |
| Analysis is image by image, then field-level interpolation; no orthomosaic; no confidence shown to users | taranis.com/analysis; Pixelscientia podcast 2023-01-23 |
| Only Taranis staff and contracted Part 107 pilots fly; growers cannot upload their own imagery; no public API | farms.com 2026; api-evangelist/taranis |
| Four / five / six flights per season by plan tier, GDU-timed; "no flights by appointment or on demand" | taranis.com blog "Why six missions", 2025-04-24; service plans page |
| Sold annually per "Subscribed Acre" through retailers; 10-acre minimum blocks; auto-renew; non-refundable; liability capped at 12 months' fees; output "not complete or error-free" | taranis.com Services Description and Terms of Service |
| Terms grant Taranis "full access to use Customer Data for internal purposes, including future product developments"; Taranis owns derived and anonymous information | Terms of Service §6.3–6.5 |
| Corn and soybean "most effective"; potatoes, sugar beets, sorghum, rice, cane, cotton "in development" after ten years; no orchard product | farms.com 2026 |
| Granted patents (US 10,182,214; US 11,050,979; family WO 2016/110832) claim the capture pod: a motion-compensating rotating optic, per-frame focus, sub-millimetre frames under 20 m. No claims on row detection, plant counting, weed mapping, species ID, sampling design or georeferencing | Google Patents |
| Training corpus "hundreds of millions of tagged leaf-level images"; continuous retraining because of season-to-season drift; a share of every mission reviewed by in-house agronomists; prompt engineering "only got us to about 50% acceptable outputs" for the Ag Assistant | taranis.com blog 2026-02-10; CTO white paper April 2023; SuperAnnotate case study 2025-04-17 |
| Brazil closed mid-July 2025 ("global restructuring to strengthen focus on the United States"); Brazilian entity liquidated May 2026 | AgFeed 2025-08-27; Econodata registry |
| Channel: Nutrien (investor; "Digital Scout powered by Taranis"), Syngenta (strategic partnership 2025-10-07, Midwest retailers), Pivot Bio, Alcivia, Landus, Apex Ag (Arkansas, 2026-01-28) | company and partner releases |
| Jan 2026: SiFly Q12 three-hour VTOL validation program to cut "operational friction" in capture | taranis.com newsroom 2026-01-21 |

## What customers and the market report

| Weakness | Who | Structural? |
|---|---|---|
| Missed tar spot that the grower found on foot: "would have needed to be obvious in the upper canopy, at that point it's too late" | AgTalk grower, July 2024 | inherent to nadir imagery at sample points |
| No ROI after a full season; reps "promised to point out examples that would show its value" | Nebraska farmer, AgTalk, July 2024 | partly structural |
| Only stand count after replant and variable-rate seeding seen as useful; "doesn't justify the cost of a whole season" | AgTalk | structural: season-long subscription |
| Couldn't turn output into quick field action | AgTalk, 2025 | fixable, but tied to the retailer middleman |
| Sampling sold as coverage (see SLA above) | Taranis's own documents | inherent to sub-millimetre economics |
| Calendar-locked flights, 10–20 day gaps, 72 h results, no re-flight clause, long weather and access exclusion list | Taranis's own documents | inherent to the contracted-pilot model |
| Pilot safety and pay complaints (BVLOS allegations, late pay) | Indeed reviews, 2020 and 2023, anonymous | structural to contractor pilots |
| "You need to physically walk every field to know accurately what's going on" | grower quoted by IBJ; Wilbur-Ellis agronomist in CropLife | inherent |
| Trust: 6% of farmers trust AI tools against 56% who trust agronomists | McKinsey Global Farmer Insights 2026 | market-wide |
| Retailers: imagery "struggling to gain adoption"; 33% say machine-vision weed systems lose money; only 4% offer them | CropLife/Purdue Precision Dealer Survey 2025 | market-wide |

Not found: a public 2025–26 price list (2018: $5–20 per acre per season; retailer anecdote 2023: about two bushels of
corn per acre); acres after 2023; headcount after 2022; any layoff press; lawsuits; FAA actions; a university accuracy
trial of Taranis; US retailer churn stories.

## Independent evidence on the method

- Montana State NARC 2025 trials (Frontiers in Agronomy 2026, 10.3389/fagro.2026.1817915): drone at 65 ft against a
  camera sprayer. Omission rates RGB/ExG 41–65%, NIR 48–74%, YOLO 78–85%. YOLO "located weed patches well but severely
  undercounted"; RGB thresholding was the most consistent; the camera found coin-sized weeds under residue that drones
  missed. Drone maps "can still help locate major weed patches".
- Weeds concentrate at field edges (Metcalfe et al. 2019, about 300 UK fields) and in patches (86% of surveyed species
  patchy). Inference: a 1.5-frames-per-acre lattice has no systematic edge coverage.
- Stand-count tools: UNL/UGA 2023 (Sentera at the default 50 ft under-counted soybeans 105k → 72k per acre; 20 ft
  needed); MSU 2024–25 (all non-manual methods except BeanCam correlated under 0.30 with manual counts; "fee-based
  options carried significant costs without delivering the accuracy needed"); Purdue 2019 (DroneDeploy and Progeny
  "within an acceptable margin", no numbers).
- Grower-owned drones: Iowa 2025 poll, 22% used a drone or drone service, a quarter of those own one; South Dakota
  2025 survey, about 25% adopters, 20% of them unsure it pays; 85% of US farms are small (NASS typology); 55% of
  connected US farms on broadband, 24% on satellite (USDA, August 2025).
- Rules: FCC added foreign-made drones to the Covered List on 2025-12-22 (existing models still allowed; new models
  blocked); DJI's newest models never officially sold in the US. EU C0 under 250 g flies in A1 with registration only;
  UK Flyer ID from 100 g from 2026; Brazil RBAC 100 exempts ≤ 250 g; Australia sub-2 kg "excluded" category over your
  own land. Inference: a product that works from any drone's kept frames is not exposed to the DJI situation.

## Rivals in one line each

Sentera (acquired by John Deere, May 2025; self-flown; $99–1,499/yr plans; weed prescriptions within 24 h);
Intelinair/AGMRI (plane at ≤ 15 cm/px, whole field, corn/soy, ~$5/acre in 2020); Solvi (upload your own, EUR
499–7,499/yr, annotate a sample per job); Agremo (upload your own, $349/yr starter; MSU found its counts tracked the
seeding rate, not the manual count); Pix4Dfields ($1,990/yr desktop, the only offline analytics found); DroneDeploy Ag
($1,908/yr; twin rows unsupported); Greeneye and Verdant (sprayer cameras, $239k and $350k); Skippy Scout (UK, own
Mavic Mini, sampling points); Aerobotics (orchards, quote-priced, strict sensor rules); Farmers Edge (taken private at
C$0.35 vs $17 IPO); Hummingbird (left scouting for carbon); PrecisionHawk (bankrupt 2023 after $136M). No rival
mentions Taranis by name. Nobody offers orchards and row crops in one self-serve tool.

## The inversion

| Taranis | Swardus |
|---|---|
| Sampling sold as "every acre captured" (about 6% at leaf level) | Full-field coverage at 2–4 cm/px, edges included, patch-level claims only |
| Four to six calendar-locked flights, no on-demand, 72 h result window | The grower flies the morning they worry; the result in the browser the same session |
| Only Taranis pilots fly; no own-drone upload; no API | Any drone's kept frames; no dependence on a new DJI model |
| Retailer-only; 10-acre minimum blocks; annual non-refundable contracts | Direct to the farmer, any size |
| Corn and soy only; no orchards; non-US dormant | Four row crops and orchards in one tool; owner-flown capture legal in the EU, UK, Brazil, Australia with minimal paperwork |
| Cloud-only; annotation armies behind the AI; full data rights taken; no confidence shown; no published validation | A pattern method the farmer can see and check; local processing; farmer-owned data; limits stated plainly |

## Strengths to match

1. Stand count at emergence is the anchor: the one feature their critics still valued, and it feeds their yield model.
   Swardus's "crops by the pattern, skips where bare" (2026-10-21) is that count, read full-field, not interpolated.
2. Growth-stage cadence: VE, V2–V3, V4–V5, V10–V12, VT, R1–R2 for corn; V1, +10, +10, +20, +18, +18 days for soy. The
   capture planner should speak those windows.
3. Agronomist-ready workflow: a season timeline, marks on the source photo, offline review on the phone, push alerts.
4. Economic translation: bushels per acre at risk per threat. Swardus states treated area and area at risk, never a
   product rate (`decision-support-not-prescriptions`).
5. Trust signals: theirs come from Nutrien and Syngenta; ours must come from the visible method and honest limits.

## Sources

Taranis: taranis.com/sla, /services-description, /terms-of-service, /service-plans, /flight-operations, /analysis,
/leadership, /careers; blogs "One acre, one image" (2024-03-15), "Why six missions" (2025-04-24), "Hundreds of millions
of leaves later" (2026-02-10), "Early tar spot detection" (2024-08-10), "FlyGuys" (2023-05-01); newsroom: AcreForward
(2023-01-31), Ag Assistant (2024-07-17), Yield Impact (2026-05-11), SiFly (2026-01-21), Apex Ag (2026-01-28), Syngenta
(2025-10-07); CTO white paper "Agriculture and AI" (April 2023, go.taranis.com); knowledge.taranis.ag (Mission
Recommendations, Yield Impact FAQ, Qcomment, Deere integration). Patents: US10182214B2, US11050979B2, WO2016110832A1,
US20210019903A1 (Google Patents). Press: Globes 2022-09-07; AgFeed 2023-11-03 and 2025-08-27; VentureBeat and TechCrunch
2018-11-06; AgFunderNews 2018-05 and 2020-07-21; IEDC 2020-12-10; Inside Indiana Business 2023-04-19; farms.com
2026-03-20 and Spring 2026 digest; Future Farming 2022-05-18; Google Cloud and DoiT case studies; SuperAnnotate
2025-04-17; Pixelscientia podcast 2023-01-23. Customer side: talk.newagtalk.com threads 1166926 and 1224065; Indeed and
Glassdoor review snippets; IBJ "A closer look"; CropLife "How precision ag professionals are finding value in imagery";
CropLife/Purdue 2025 Precision Dealer Survey; McKinsey Global Farmer Insights 2024 and 2026. Rivals and evidence:
sentera.com/pricing; agremo.com/pricing; pix4d.com/pricing; dronedeploy.com/pricing; aerobotics.com; cropwatch.unl.edu
2023 soybean stand-count evaluation; canr.msu.edu soybean stand assessment; extension.purdue.edu popcorn stand counts;
crops.extension.iastate.edu drone weed mapping (2024-12); agresearch.montana.edu NARC precision ag update (August 2026)
and 10.3389/fagro.2026.1817915; Metcalfe et al. 2019, Journal of Applied Ecology; USDA Farm Computer Usage August 2025;
Iowa Farm and Rural Life Poll 2025; SDSU 2026 drone survey (10.1007/s11119-026-10387-w); FCC Covered List (dronelife
2025-12-22; AUVSI FAQ); EASA open category; CAA UK 2026 rules; ANAC RBAC 100; CASA weight categories.
