# ANIKEY PDR

Work authorization, completion & acceptance, and invoicing for paintless dent repair (hail). Every job has three documents: **PDR Work Authorization**, **PDR Completion & Acceptance** and **Invoice**. Each one is sent to the customer by email link, signed on a phone or computer, and a signed PDF copy is stored.

## Run it locally

```bash
cp .env.example .env          # set DATABASE_URL, DIRECT_URL, AUTH_SECRET (openssl rand -base64 48)
npm install
npx prisma migrate deploy     # or apply prisma/migrations/*/migration.sql with psql
npm run db:seed               # creates the company, an admin and (optionally) a technician
npm run dev                   # http://localhost:3000
```

In development emails are printed to the server log (`EMAIL_PROVIDER=console`) and files go to `.storage/`.

## Checks

```bash
npm run typecheck
npm test                      # unit + integration (needs a local Postgres, see vitest.config.ts)
npm run build
```

## Deploy (Vercel + Supabase)

1. Create a Supabase project. Use the pooled URL (`?pgbouncer=true`) as `DATABASE_URL` and the direct URL as `DIRECT_URL`.
2. Create a **private** storage bucket and set `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`.
3. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (verify the sending domain).
4. Set `APP_URL` to the public URL and a strong `AUTH_SECRET`.
5. Run `prisma migrate deploy` against `DIRECT_URL`, then `npm run db:seed` once.

See `docs/ARCHITECTURE.md` for how the pieces fit and how to swap providers.
