# 🛰 AI-Based Smart Property Management

Detect property changes, monitor construction, compare satellite images, manage parcels by **survey number**,
and generate **AI alerts** grounded in regulations.

| Layer | Technology |
|---|---|
| Backend | Node.js 20+, Express.js, REST API, Zod validation, Multer uploads, node-cron |
| Database | PostgreSQL 16 + **PostGIS** (parcel boundaries, spatial joins) + **pgvector** (RAG embeddings), **Prisma ORM** |
| Imagery | `sharp` + a built-in change-detection engine (radiometric normalisation, land-cover classification, morphology, connected components) |
| Agentic AI | **LangGraph** (StateGraph monitoring agent + ReAct assistant), **LLM** via any OpenAI-compatible API, **RAG** over pgvector |
| UI | Single-page console (Leaflet map, before/after slider, alerts, construction, AI chat) |

---

## Architecture

```
                ┌─────────────── public/index.html (Leaflet console) ───────────────┐
                │  map of survey parcels · alerts · before/after slider · AI chat    │
                └──────────────────────────────┬─────────────────────────────────────┘
                                               │ REST /api/*
┌──────────────────────────────────────────────▼────────────────────────────────────────────┐
│ Express API  (src/routes)                                                                  │
│  properties · survey lookup · images · detect · scan · construction · alerts · knowledge   │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Services (src/services)                                                                    │
│  changeDetection.js  ← satellite image comparison engine (sharp)                           │
│  detectionService.js ← runs comparisons, stores regions as PostGIS polygons                │
│  geoService.js       ← PostGIS: survey lookup, point-in-parcel, neighbours, encroachment   │
│  constructionService ← progress vs S-curve schedule, permit coverage, stall detection      │
│  alertRules.js       ← deterministic, auditable alert rules                                │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Agentic AI (src/agents)                                                                    │
│  monitoringGraph.js  LangGraph: detect → construction → rules → RAG → LLM → persist        │
│  assistantAgent.js   LangGraph ReAct agent with 8 tools (survey lookup, alerts, scan, RAG) │
│  rag/                pgvector store, chunker, embeddings (OpenAI or offline hashing)       │
└──────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                               │ Prisma + raw SQL
                     PostgreSQL 16 · PostGIS (geometry 4326, GIST) · pgvector (HNSW)
```

### The monitoring agent (LangGraph)

```
START → detect_changes ─┬─(no image pair)──────────────────────────────┐
                        └→ check_construction → apply_rules ─┬─(none)──┤
                                                             └→ retrieve_regulations (RAG)
                                                                → ai_assessment (LLM, structured)
                                                                → persist_alerts → finish → END
```

* **Rules decide _whether_** something is wrong (unpermitted build, encroachment, coverage over permit,
  land-use conflict, demolition, vegetation loss, delay/stall) — deterministic and auditable.
* **The LLM explains _why it matters_**, calibrates severity (±1 level), recommends next action and
  **cites the retrieved regulation chunks**. Every run is logged in `agent_runs` with its step trace.
* With no API key the system still works in **rules-only mode** (template recommendations + offline
  hashing embeddings for RAG).

### Change-detection engine (`src/services/changeDetection.js`)

1. Crop both images to their common geographic extent and resample to one grid.
2. Radiometric normalisation using pseudo-invariant (unchanged) pixels → removes seasonal / lighting shifts.
3. Per-pixel land cover: vegetation (Excess-Green), built-up (bright/low-saturation or tiled roofs), soil, water.
4. Colour-distance change map → blur → threshold → morphological open/close → connected components.
5. Each region is typed by its dominant transition (`VEGETATION→BUILT = NEW_CONSTRUCTION`, `BUILT→SOIL = DEMOLITION`, …) with a confidence.
6. Regions are geo-referenced, stored as PostGIS polygons and intersected with **your parcel and all neighbouring
   survey parcels** → encroachment with the exact overlap in m² and the neighbour's survey number.
7. A PNG overlay is produced (red = change, coloured boxes by type, parcel outline).

The engine's output contract (`regions[]`, `stats`) is model-agnostic: you can replace
`classifyPixels/changeMagnitude` with a deep-learning model (e.g. a Siamese U-Net / ChangeFormer served over HTTP)
without touching the rest of the system.

---

## Quick start

```bash
# 1. Database (PostGIS + pgvector)
docker compose up -d db

# 2. App
cp .env.example .env          # set OPENAI_API_KEY (optional — rules-only without it)
npm install
npm run setup                 # prisma generate → extensions → db push → indexes → demo images → RAG ingest → seed + 2 AI scans
npm run dev                   # http://localhost:4000
```

Open **http://localhost:4000** — the demo seeds 4 parcels in Yelahanka (Sy. No. 123/4, 123/5, 124/1, 125 Gomala),
three satellite captures (Jan / Jun / Nov 2026) and a building permit, then runs the agent twice. You should see:

* **Vegetation loss** (Jan → Jun: site cleared)
* **Encroachment** — a shed on 123/4 crosses onto **Sy. No. 123/5** (overlap in m²)
* **Permit violation** — ground coverage above the permitted 30 %
* Construction progress vs plan on the Construction tab

Run tests (no database needed): `npm test` — change-detection engine, alert rules, chunker.

Everything in Docker: `docker compose up -d --build`, then `docker compose exec api npm run setup`.

### Using a different LLM
Any OpenAI-compatible endpoint works: set `OPENAI_BASE_URL` (e.g. `http://localhost:11434/v1` for Ollama),
`LLM_MODEL`, `EMBEDDING_MODEL`. If your embedding size isn't 1536, change `EMBEDDING_DIM` **and**
`vector(1536)` in `prisma/schema.prisma`.

---

## REST API

Interactive docs (Swagger UI): **http://localhost:4000/api/docs**, raw OpenAPI 3 spec at `/api/openapi.json`
(source: `src/docs/openapi.js`).

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health + LLM mode |
| GET | `/api/dashboard/stats` | Counts, alerts by severity/type, projects by status |
| GET | `/api/properties?district=&village=&landUse=&q=` | List parcels |
| POST | `/api/properties` | Create parcel (`surveyNumber, subDivision, village, district, state, ownerName, landUse, boundary` GeoJSON Polygon) |
| GET | `/api/properties/survey/:surveyNumber?subDivision=&village=&district=` | **Survey-number lookup** |
| GET | `/api/properties/at?lon=&lat=[&radius=m]` | Parcel at a GPS point / parcels nearby |
| GET | `/api/properties/geojson` | All parcels as FeatureCollection (with open-alert severity) |
| GET / PATCH / DELETE | `/api/properties/:id` | Detail (neighbours, open alerts, projects) / update / delete |
| POST | `/api/properties/:id/images` | Upload image (multipart `image` + `capturedAt, minLon, minLat, maxLon, maxLat, source, cloudCover`) |
| GET | `/api/properties/:id/images` | Image timeline |
| POST | `/api/properties/:id/detect` | **Compare satellite images** (body optional: `beforeImageId, afterImageId`) |
| POST | `/api/properties/:id/scan` | **Full AI agent run** → alerts |
| GET | `/api/properties/:id/detections` · `/agent-runs` | History / agent audit trail |
| GET | `/api/detections/:id` · `/:id/overlay` | Detection detail with PostGIS encroachment report / overlay PNG |
| GET | `/api/images/:id/file` | Raw image |
| GET / POST | `/api/construction` | List / create permit project (`permittedBuiltUpPct, targetBuiltUpPct, startDate, expectedEndDate…`) |
| GET | `/api/construction/:id` | Progress timeline vs plan |
| GET | `/api/alerts?status=&severity=&propertyId=` | AI alerts |
| PATCH | `/api/alerts/:id` | `{ "status": "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED" }` |
| POST | `/api/knowledge` | Add a regulation document to RAG (`source, title, text`) |
| GET | `/api/knowledge/search?q=` | Semantic search |
| POST | `/api/agent/chat` | AI assistant `{ question, propertyId?, history? }` (needs LLM) |

See `requests.http` for ready-to-run examples.

---

## Project layout

```
prisma/schema.prisma            data model (PostGIS geometry + pgvector as Unsupported types)
scripts/                        init-db (extensions, GIST/HNSW indexes, area trigger), seed, ingest-docs, demo images
src/app.js · server.js          Express app / bootstrap (+ nightly monitor via MONITOR_CRON)
src/routes/                     REST endpoints
src/services/                   change detection, PostGIS, construction, alert rules, alerts
src/agents/                     LangGraph monitoring graph + ReAct assistant
src/rag/                        chunker, embeddings, pgvector store
docs/knowledge/                 SAMPLE regulation documents for RAG — replace with your authority's real bye-laws
public/index.html               monitoring console
tests/                          node:test unit tests
```

## Production notes

* The regulation documents in `docs/knowledge` are **illustrative samples**, not real law — ingest your own.
* Satellite findings are probabilistic; the agent always recommends field verification before enforcement.
* Real imagery: use co-registered, orthorectified captures (Sentinel-2 at 10 m is fine for large changes; for
  individual buildings use ≤ 1 m imagery or drone orthomosaics). Supply the image extent (EPSG:4326) on upload.
  GeoTIFFs can be converted to PNG + extent with `gdal_translate` / `gdalinfo`.
* Add authentication (JWT / OAuth) and role-based access before exposing the API publicly.
