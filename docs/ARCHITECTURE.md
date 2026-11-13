# Architecture

## Layers

```
pages / server actions / route handlers      src/app, src/components     (thin: parse form, call a service, render)
        |
services (domain rules, take an Actor)        src/services                (framework-free, fully integration-tested)
        |
providers (swappable by env)                  src/providers               storage, email, signature, pdf
        |
Prisma / PostgreSQL                           prisma/                     multi-tenant: orgId on top-level tables
```

Rules live only in services. UI code never touches the database for writes, so a mobile app or public API can later reuse the same services.

## Documents and versions

`Document` (one per job and type) has many `DocumentVersion` rows: DRAFT, SENT, SIGNED, SUPERSEDED, VOID.

- A signed version is never modified. Changing it creates version N+1, which needs a new signature; the older one becomes SUPERSEDED when the new one is signed.
- Revising a sent but unsigned version voids it and revokes its link.
- The signed content is fingerprinted (SHA-256 of canonical JSON). The hash is stored at send time and re-checked at signing time, so what was sent is exactly what is signed.
- Terms and payment instructions are copied into each document when it is created, so later edits in Settings never change old documents.

## Signing links

32 random bytes; only the SHA-256 hash is used for lookup. The token is also stored AES-256-GCM encrypted so staff can copy the link again. Links expire (`signingLinkDays`), are revoked on resend/revise/cancel, and `/s/*` is `no-store` and `noindex`. Signing claims the request atomically (`updateMany where status = SENT`), so two simultaneous submissions produce one signature. The signature image, signer name/title, time, IP and user agent are stored; the PDF is generated after the transaction commits and can be regenerated.

## Audit trail

Append-only `AuditLog` per organization, hash-chained (each row includes the previous hash) and written under a per-org advisory lock. `/audit` re-verifies the chain, so edits or deletions are detected.

## Scaling notes

- Job lists and dashboards read denormalized summary columns on `Job` (service, amount, paid, due date, status), kept current by `refreshJobSummary`. "Overdue" is derived from due date in the company time zone, so no cron job is needed.
- Indexes cover `(orgId, status)`, `(orgId, createdAt)` and `(orgId, dueDate)`.
- Money is integer cents; document dates are ISO strings; timestamps are UTC and shown in the company time zone.
- The login rate limiter is in memory (per instance). For more than one instance, replace `src/lib/rate-limit.ts` with Redis/Upstash.

## Swapping providers

| Concern | Interface | Included | Add later |
|---|---|---|---|
| Files | `providers/storage` | local, memory, Supabase (REST) | S3 |
| Email | `providers/email` | console, memory, Resend | Postmark, SES |
| E-signature | `providers/signature` | internal drawn-signature capture | DocuSign / Dropbox Sign (this is the seam) |
| Auth | `services/auth` + `lib/session` | email + password (bcrypt, signed JWT cookie) | Supabase Auth / Clerk |

## Roadmap ideas

- Phase 2: customer portal, overdue reminder emails (scheduled), text-message links, photos inside the PDF.
- Phase 3: QuickBooks export, insurance/PO workflows, multiple locations, reports.
