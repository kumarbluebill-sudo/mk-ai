# Cloud Deployment Guide

Status: configuration provided, **not yet deployed or tested** (no Docker or hosted database was available during development).

## Environments

Use separate databases, `AUTH_SECRET`, `ENCRYPTION_KEY` and supplier keys for development, staging and production. Production should use `VIATOR_API_ENV=production` only after Viator approves production access.

## Option A: Vercel + managed services

1. Managed PostgreSQL (e.g. Neon, RDS, Supabase). Set `DATABASE_URL`.
2. Vercel project: set env vars from `.env.example` (`AUTH_SECRET`, `ENCRYPTION_KEY`, AI and Viator keys, `APP_URL`).
3. Run `npx prisma migrate deploy` as a release step against the target database (not at request time).
4. Custom domain + HTTPS through Vercel. Set `AUTH_URL` to the public URL if the host is not auto-detected.
5. Redis (Upstash/ElastiCache) once rate limiting moves off in-memory.

## Option B: Containers (ECS/Fargate, Render, Railway)

- `Dockerfile` builds a standalone Next.js image (`BUILD_STANDALONE=1`), runs as a non-root user, and has a `/api/health` health check.
- `docker compose up --build` runs Postgres, Redis, a one-shot migration job and the app locally. Set `AUTH_SECRET` and `ENCRYPTION_KEY` in `.env`.
- On ECS: run `prisma migrate deploy` as a separate one-off task before updating the service. Store secrets in Secrets Manager. Put an ALB with HTTPS (ACM) in front and use `/api/health` as the target health check.
- Behind a proxy set `AUTH_TRUST_HOST=true`.

## Still needed for production

Backups and point-in-time recovery, log shipping and error reporting (e.g. Sentry), uptime monitoring, background worker for long jobs, S3-compatible storage for documents, CDN. None of these are configured yet.
