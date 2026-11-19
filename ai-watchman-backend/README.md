# AI Watchman — Node.js Backend

Starter backend for monitoring registered property boundaries with Sentinel-2 satellite imagery. It includes a REST API, PostgreSQL/Prisma data layer, JWT authentication, monitoring jobs, land-change records, alerts, reports, Swagger UI, Docker Compose and a Redis/BullMQ worker foundation.

> **Important:** This is a development starter. Before production use, add formal authorization policies, audit logging, tests, database backups, secrets management, robust geospatial validation, monitoring, and review of all satellite-derived results. The change-record API accepts analyst/system-created records; this starter does not claim that every detected change is automatically classified.

## Stack
- Node.js 22+, Express 5
- PostgreSQL 16 with PostGIS image
- Prisma ORM
- JWT + bcrypt password hashing
- Google Earth Engine JavaScript API (optional; configured separately)
- Sentinel-2 Surface Reflectance Harmonized collection
- Redis + BullMQ background queue
- Swagger UI / OpenAPI 3

## 1. Requirements
- Node.js 22 or newer and npm
- Docker Desktop (recommended) OR PostgreSQL 16 with PostGIS and Redis 7 installed locally
- Google Cloud project and Earth Engine access if you want satellite endpoints to run

## 2. Start database and Redis
From this project directory:

```bash
docker compose up -d postgres redis
```

This starts PostgreSQL on `localhost:15432` and Redis on `localhost:6379`.

## 3. Configure environment
Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

Edit `.env`. Set a strong `JWT_SECRET` (at least 24 characters). The default local database URL is:

```text
postgresql://postgres:postgres@localhost:15432/ai_watchman?schema=public
```

For Google Earth Engine, set `GEE_PROJECT_ID`, `GEE_SERVICE_ACCOUNT`, and `GEE_PRIVATE_KEY`. The service account must be registered/authorized for Earth Engine and the Cloud project must be configured. Keep the private key secret; never commit `.env`.

## 4. Install and initialize Prisma

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
```

The Prisma schema stores property boundaries as GeoJSON JSON. PostGIS is included in Docker Compose for spatial SQL/indexing extensions as the project grows. If you need native geometry columns and spatial indexes, add a reviewed SQL migration using `geometry(Polygon, 4326)` and `GIST` indexes; GeoJSON JSON storage alone is not a PostGIS geometry column.

## 5. Run the API and worker
Open two terminals:

Terminal 1:
```bash
npm run dev
```

Terminal 2:
```bash
npm run worker
```

API: `http://localhost:4001`
Swagger: `http://localhost:4001/api/docs`
Health: `http://localhost:4001/api/health`

## 6. Docker full stack (optional)
The Compose API and worker use the PostgreSQL and Redis service names automatically, so `.env` can keep the `localhost` URLs used by host-run development commands. Run:
```bash
docker compose up --build
```

## 7. API quick start
Register:
```http
POST /api/auth/register
Content-Type: application/json

{"name":"Demo Owner","email":"owner@example.com","password":"ChangeMe123!"}
```
Login:
```http
POST /api/auth/login
Content-Type: application/json

{"email":"owner@example.com","password":"ChangeMe123!"}
```
Use the returned token on protected routes:
```http
Authorization: Bearer YOUR_JWT_TOKEN
```

Register property (boundary is a GeoJSON Polygon; coordinates use `[longitude, latitude]`):
```http
POST /api/properties
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "name": "Farm Plot A",
  "address": "Coimbatore, Tamil Nadu, India",
  "areaHectares": 2.4,
  "boundary": {
    "type": "Polygon",
    "coordinates": [[[76.95,11.01],[76.951,11.01],[76.951,11.011],[76.95,11.011],[76.95,11.01]]]
  }
}
```

Queue a monitoring job:
```http
POST /api/monitoring/properties/PROPERTY_UUID/jobs
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{"startDate":"2025-01-01T00:00:00.000Z","endDate":"2025-02-01T00:00:00.000Z","cloudMaxPercent":20}
```

Check status at `GET /api/monitoring/jobs` or `GET /api/monitoring/jobs/JOB_UUID`.

## API modules
| Module | Routes |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login` |
| Properties | `GET/POST /api/properties`, `GET/PATCH/DELETE /api/properties/:id` |
| Monitoring | `POST /api/monitoring/properties/:propertyId/jobs`, `GET /api/monitoring/jobs`, `GET /api/monitoring/jobs/:id` |
| Satellite | `GET /api/satellite/properties/:propertyId/sentinel-2`, `GET .../ndvi-thumbnail`, `POST .../compare-ndvi` |
| Land changes | `GET/POST /api/changes`, `GET /api/changes/:id` |
| Alerts | `GET/POST /api/alerts`, `PATCH /api/alerts/:id/status` |
| Reports | `POST /api/reports/properties/:propertyId/generate`, `GET /api/reports`, `GET /api/reports/:id` |

## Notes / known boundaries
- Google Earth Engine requires separate project, service-account and access setup. Without those credentials, satellite calls return a configuration error; other API modules can still be developed.
- Monitoring jobs use BullMQ and are processed by `npm run worker`.
- The worker currently searches Sentinel-2 scenes and records the result. Add a validated change-detection pipeline (e.g. image normalization, cloud masking, co-registration, classification/change metrics) before generating automatic land-change records or high-confidence alerts.
- GeoJSON boundaries are persisted in a Prisma `Json` field. The PostGIS container is ready, but this starter's CRUD does not yet write native PostGIS geometry columns.
- Report generation creates a structured database report with counts and summary; PDF export can be added as a next step.

## Troubleshooting
- `P1001` / database connection: confirm `docker compose ps` and `DATABASE_URL`.
- Redis connection error: confirm Redis is running and `REDIS_URL` is correct.
- Prisma client missing: run `npx prisma generate`.
- Earth Engine authentication: verify service-account email, private key newlines, Earth Engine registration and Cloud project ID.
