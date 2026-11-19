# Endpoint reference
All routes except `/auth/*` and `/health` require `Authorization: Bearer <JWT>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login and receive JWT |
| GET, POST | `/api/properties` | List/create properties |
| GET, PATCH, DELETE | `/api/properties/:id` | Read/update/delete property |
| POST | `/api/monitoring/properties/:propertyId/jobs` | Queue monitoring job |
| GET | `/api/monitoring/jobs` | List jobs |
| GET | `/api/monitoring/jobs/:id` | Get job status/result |
| GET | `/api/satellite/properties/:propertyId/sentinel-2` | Search Sentinel-2 scenes |
| GET | `/api/satellite/properties/:propertyId/ndvi-thumbnail` | Get NDVI thumbnail URL |
| POST | `/api/satellite/properties/:propertyId/compare-ndvi` | Compare two periods |
| GET, POST | `/api/changes` | List/create land-change records |
| GET | `/api/changes/:id` | Get change record |
| GET, POST | `/api/alerts` | List/create alerts |
| PATCH | `/api/alerts/:id/status` | Acknowledge/resolve alert |
| POST | `/api/reports/properties/:propertyId/generate` | Generate report |
| GET | `/api/reports` | List reports |
| GET | `/api/reports/:id` | Get report |
