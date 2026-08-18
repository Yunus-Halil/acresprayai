# SwathWise — System Reference

A complete description of what the SwathWise platform does today: every screen, every
table, every service contract, every algorithm, and — equally important — the things it
deliberately does not do.

Written to be read cold, by a person or a model, with no prior context. If you are handing
this codebase to someone (or something) new, this directory is the handover.

## What SwathWise is, in one paragraph

A web application for farmers and agricultural drone operators. It takes a folder of
overlapping drone photographs of a field, turns them into a single georeferenced aerial image
(an **orthomosaic**), lets the farmer draw the exact outline of their land on it, runs a vision
model over the imagery to flag patches that look wrong, and generates a flyable spray mission
that treats only those patches instead of the whole field.

## Contents

### Start here
| Document | Covers |
|---|---|
| [overview.md](overview.md) | What the product is, the core data shape, the design stance |

### Architecture
| Document | Covers |
|---|---|
| [architecture/stack.md](architecture/stack.md) | Runtime shape, external services, repository layout |
| [architecture/data-model.md](architecture/data-model.md) | Every table and column, active and dormant |
| [architecture/storage.md](architecture/storage.md) | Buckets, path conventions, the reproducibility gap |
| [architecture/auth.md](architecture/auth.md) | Sign-in, RLS, how each surface is gated |

### Pipeline
| Document | Covers |
|---|---|
| [pipeline/scan-lifecycle.md](pipeline/scan-lifecycle.md) | Upload → reconstruct → mirror → bake → view, step by step |
| [pipeline/edge-functions.md](pipeline/edge-functions.md) | Full contract for all nine functions |
| [pipeline/resilience.md](pipeline/resilience.md) | Every failure mode and how it is handled |

### Features
| Document | Covers |
|---|---|
| [features/screens.md](features/screens.md) | Routes and what the user does on each |
| [features/workspace.md](features/workspace.md) | The orthomosaic workspace and its seven tabs |
| [features/ai-analysis.md](features/ai-analysis.md) | The exact AI contract, constraints and enforcement |
| [features/mission-planner.md](features/mission-planner.md) | Sweep geometry, flight physics, battery model |
| [features/cost-and-reports.md](features/cost-and-reports.md) | Cost mapping and PDF report generation |
| [features/export-formats.md](features/export-formats.md) | GeoJSON and QGC WPL 110 waypoint output |
| [features/pilot-applications.md](features/pilot-applications.md) | The pilot application form, its table, and how applications reach you |

### Operations
| Document | Covers |
|---|---|
| [operations/running.md](operations/running.md) | Commands, configuration, secrets, test coverage |
| [operations/limits.md](operations/limits.md) | What is not built, and constraints to design around |
| [operations/seo.md](operations/seo.md) | Titles, link-preview cards, robots, sitemap, indexability |

## Quick facts

| | |
|---|---|
| Frontend | Vite · React 18 · TypeScript · Tailwind · shadcn/Radix |
| Backend | Supabase — Postgres + PostGIS, Auth, Storage, Deno Edge Functions |
| Photogrammetry | OpenDroneMap (NodeODM / WebODM Lightning) |
| Tile rendering | TiTiler (public `titiler.xyz`) |
| Vision model | Gemini 2.5 Flash by default, via any OpenAI-compatible endpoint |
| Weather | OpenWeather One Call 3.0, falling back to Open-Meteo |
| Transactional email | Resend (pilot application notifications) |
| Edge functions | 11 |
| Tables | 15 (9 active, 6 dormant) |
| Platform deps | None — no Lovable, no vendor lock-in |
| Tests | 272 — pure logic, edge-function contracts, upload resume, workspace smoke, form and RLS contracts |

## Conventions used in these docs

- Paths are relative to the repository root.
- "Scan" in the UI means a row in the `odm_tasks` table. The names differ; the object is the same.
- Where a document states a limit or a constant, it is the value in the code, not an aspiration.
