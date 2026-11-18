# Tax Filing Services API

A learning/reference backend for customer tax-return preparation and auditor review workflows. It uses Express, TypeScript, Prisma, and PostgreSQL.

## Requirements
- Node.js 20+
- Docker Desktop or PostgreSQL 16
- npm

## Run locally

```powershell
# Start PostgreSQL and Redis
docker compose up -d

# Install dependencies and create the local environment file
npm install
Copy-Item .env.example .env

# Generate Prisma Client
npm run prisma:generate

# On a fresh, empty tax-filing database only, apply the schema
npx prisma db push

# Insert demo data
npm run db:seed

# Start the API
npm run dev
```

PostgreSQL is published on host port `5434` and Redis on `6380` to avoid conflicts with the previous local services. The containers listen on ports `5432` and `6379`, respectively. Docker uses a new `tax_filing_pg` volume; the previous database and volume are left untouched.

**Existing database warning:** the previous local database uses a different schema. Do not apply the tax-filing schema to it. This Compose configuration creates a separate database and volume for tax-filing.

API: <http://localhost:4000>  
Swagger UI: <http://localhost:4000/docs>  
Health: <http://localhost:4000/health>

## Demo accounts
The seed creates:
- Admin: `admin@demo.com`
- Customer: `customer@demo.com`
- Auditor: `auditor@demo.com`

All demo accounts use the password `Demo@12345`. Change demo credentials and the JWT secret before sharing or deploying. Never use seeded credentials in production.

## Implemented workflows
- Customer and auditor registration and login with role-based access.
- Tax return drafts, income and deduction records, submission, review, and filing-status history.
- Document metadata registration and auditor review.
- Auditor assignment, findings, report records, and tax-computation updates.
- Pending payment records and admin status updates. No payment gateway or file-storage provider is connected.

This is a sample workflow, not tax advice or tax-calculation software. Add a verified tax rules engine, secure document storage, payment provider, automated tests, observability, backups, and security review before production.

## Project docs
See `docs/API_DOCUMENTATION.md` and `docs/ARCHITECTURE.md`.
