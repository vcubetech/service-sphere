# API documentation

Base URL: `http://localhost:4000/api`. Protected routes require `Authorization: Bearer <JWT>`.

## Authentication
- `POST /auth/register` — create a CUSTOMER (requires `panNumber`) or AUDITOR account. ADMIN registration is not public.
- `POST /auth/login` — `{email,password}`; returns a JWT.
- `GET /auth/me` — current user and customer/auditor profile.

## Profiles
- `GET /customers/me`, `PATCH /customers/me` — CUSTOMER profile.
- `GET /auditors/me`, `PATCH /auditors/me` — AUDITOR profile.
- `GET /auditors` — ADMIN list.
- `PATCH /auditors/:id/status` — ADMIN verification status.

## Tax returns
- `GET /tax-returns/financial-years` — active financial years.
- `GET /tax-returns` — list tax returns visible to the authenticated role.
- `POST /tax-returns` — CUSTOMER creates a draft.
- `GET /tax-returns/:id` — return details, income, deductions, documents, audit, and filing history.
- `PATCH /tax-returns/:id` — CUSTOMER updates draft/query-raised return metadata.
- `POST /tax-returns/:id/submit` — CUSTOMER submits a return for review.
- `POST /tax-returns/:id/income` — add income details to an editable return.
- `POST /tax-returns/:id/deductions` — add a deduction to an editable return.
- `PUT /tax-returns/:id/computation` — assigned AUDITOR or ADMIN records tax computation.
- `PATCH /tax-returns/:id/status` — ADMIN advances an approved return through filing and verification.

## Documents and audits
- `GET /documents` — list documents visible to the authenticated role.
- `POST /documents` — CUSTOMER adds document metadata; this does not upload a file.
- `PATCH /documents/:id/review` — assigned AUDITOR or ADMIN changes document review status.
- `POST /audits/assignments` — ADMIN assigns a verified, available auditor.
- `GET /audits/assignments` — list assignments visible to the authenticated role.
- `PATCH /audits/assignments/:id/status` — assigned AUDITOR or ADMIN updates audit status.
- `POST /audits/assignments/:id/findings` — add a finding.
- `PATCH /audits/assignments/:id/findings/:findingId` — resolve a finding.
- `PUT /audits/assignments/:id/report` — create or update an audit report record.

## Payments and administration
- `GET /payments` — list payments visible to the authenticated role.
- `POST /payments` — CUSTOMER creates a PENDING payment record; no funds are charged.
- `PATCH /payments/:id/status` — ADMIN records PAID, FAILED, or REFUNDED status.
- `GET /admin/dashboard` — ADMIN summary.
- `GET /admin/financial-years`, `POST /admin/financial-years`, `PATCH /admin/financial-years/:id` — ADMIN financial-year management.

Swagger UI: `GET /docs`. OpenAPI JSON: `GET /openapi.json`.
Health checks: `GET /health` and `GET /api/health`. The Swagger health operation
uses the API base URL (`/api`), so `/api/health` is the documented URL.
Swagger documents request bodies, path/query parameters, authentication, and
success/error response schemas for every registered API endpoint.
