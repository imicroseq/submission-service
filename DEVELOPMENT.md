# Development guide

## Repository structure

- `src/` — application code: `index.ts`/`server.ts` (entry point), `controllers/`, `routers/`, `middleware/`, `service/`, `repository/`, `db/` (Drizzle schema/client), `submission/`, `submitted-data/`, `indexer/`, `core/`, `common/`, `templates/`, `scripts/` (migration entry points), `api-docs/` (Swagger YAML)
- `migrations/` — Drizzle-generated SQL migrations, copied into `dist/` at build time
- `docs/` — published/consumer-facing docs (currently a DBML custom schema model)
- `.dev/` — internal working documents (see "Working documents" below)
- `docker-compose.yml` — local Postgres, Lectern (+ its Mongo backing store) for development
- `drizzle.config.ts` — Drizzle Kit config for schema generation/studio
- `register.ts` — module alias registration (`@/*` → `src/*`) for compiled/prod runs

## Prerequisites

- [Node.js](https://nodejs.org/en) v20 or higher
- [pnpm](https://pnpm.io/) for dependency management
- Docker (for the `docker-compose.yml` dependencies: Postgres, Lectern)
- GitHub CLI (`gh`), authenticated: any agent working in this repo uses `gh` for PRs and issues on your behalf; without it, your first GitHub-related request will stall on an auth prompt instead of just working

## Setup

1. If `gh auth status` doesn't already show you logged in, run `gh auth login` once per machine.
2. Install dependencies: `pnpm install`
3. Start local service dependencies: `docker compose up -d`
4. Create a `.env` file in the project root; copy `.env.schema` into it and fill in values for your local setup. `.env` is git-ignored and must never be committed
5. Build once so generated/copied artifacts exist: `pnpm build:all`

## Running the project

- Development mode (runs pending DB migrations, then watches and restarts on change): `pnpm start:dev`
- Swagger docs are served at `http://localhost:3030/api-docs` by default once running
- Production mode (compiled): `pnpm migrate:db:prod && pnpm start:prod`

## Database

- Drizzle ORM against Postgres; schema lives under `src/db/`
- `pnpm db:generate` — generate a new migration from schema changes
- `pnpm db:studio` — open Drizzle Studio against the configured database
- `pnpm migrate:db:dev` — run the provider and custom migration scripts (also runs automatically before `start:dev`)

## Linting

- `pnpm lint` / `pnpm lint:fix`

## Running tests

No automated test suite exists in this repository yet (no `*.test.ts`/`*.spec.ts` files, no test script in `package.json`). New and changed code should follow the co-located, BDD-style `node:test` convention described in `CLAUDE.md`/`AGENTS.md` § Testing; see `.dev/tech-debt.md` for the standing gap.

## Working documents

The `.dev/` directory contains living documents maintained alongside the codebase:

- `.dev/roadmap.md`: planned features and architectural direction; read at session start
- `.dev/tech-debt.md`: known issues, scope-adjacent problems, and deferred work
- `.dev/sessions/`: one file per contributor per day (`YYYY-MM-DDTHHMMSS.md`), brief log of what changed and why
- `.dev/docs/`: service-specific deployment notes and operational guides; indexed at `.dev/docs/index.md`; one subdirectory per service (e.g. `.dev/docs/postgres/`, `.dev/docs/lectern/`)

Read the `.dev/` files at the start of each session before beginning work. Read the relevant `.dev/docs/<service>/` guide before deploying or debugging a specific service. Update these at the end of any session that produces meaningful output.
