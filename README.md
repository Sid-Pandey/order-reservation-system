# Order Reservation System

Monorepo-style project with:

- **API service** in repo root (`index.js`, Express + SQLite)
- **Dashboard service** in `dashboard/` (Next.js)

## Local Development

From repo root:

```bash
npm run start:all
```

This runs:

- API on `http://localhost:3000`
- Dashboard on `http://localhost:3001`

## Environment Variables

### API (root)

Use `.env` (see `.env.example`):

- `OPENAI_API_KEY`
- `EXTRACTION_MODEL` (optional)
- `CORS_ORIGINS` (comma-separated, e.g. `http://localhost:3001`)

### Dashboard (`dashboard/.env.local`)

Copy `dashboard/.env.local.example` to `dashboard/.env.local` and set:

- `NEXT_PUBLIC_API_URL=http://localhost:3000`

## Railway Deployment (2 Services)

Deploy as two separate services from the same repo:

1. **API Service**
   - Root directory: repo root
   - Build command: `npm install`
   - Start command: `npm run start:api`
   - Required env vars: `OPENAI_API_KEY`, `CORS_ORIGINS`

2. **Dashboard Service**
   - Root directory: `dashboard`
   - Build command: `npm install && npm run build`
   - Start command: `npm run start`
   - Required env vars: `NEXT_PUBLIC_API_URL` set to API public URL

`start:all` is for local use only and should not be used in Railway production services.
