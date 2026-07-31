# Tech debt

Known issues, scope-adjacent problems, and deferred work. See `CLAUDE.md`/`AGENTS.md` § Tech-debt entry format.

---

Only pure-logic functions have test coverage; the DB/Song-facing submission orchestration and Express controllers remain untested
fix: `pnpm test` now runs co-located `node:test` BDD tests (`src/submission/sequencingPayload.test.ts`), started with the sequencing-metadata-submission feature per `CLAUDE.md`/`AGENTS.md` § Testing. Extend the same way for each new feature or bug fix touched, rather than a single big backfill effort. Testing the orchestration layer (`submissionHandler.ts`'s `handleSubmission`/`handleSequencingMetadataSubmission`, the `submit`/`getSubmissionById` controllers) needs either a real Postgres+Lectern+Song test environment or a mocking layer for `lyricProvider`/`song.ts`/`fileRepository`, neither of which exists yet
standalone: yes

Importing `@/core/provider.js` (directly, or transitively through any module that imports it, e.g. `submissionHandler.ts`) hangs a `node:test` run indefinitely without a live Postgres connection: the lyric `provider()` factory eagerly connects and spins up a worker pool as a module-level side effect, it isn't lazy or deferred to first use
fix: keep pure business logic (no DB/HTTP orchestration) in modules that don't import `@/core/provider.js`, following the split already made between `sequencingPayload.ts` (pure, tested) and `submissionHandler.ts` (orchestration, imports the provider). Don't add tests that import `submissionHandler.ts` or `core/provider.ts` directly without a real Postgres instance running
standalone: yes

No CI workflow runs `pnpm test` (or `pnpm lint`/`tsc --noEmit`) on pushes or PRs
fix: add a GitHub Actions workflow that runs them. `pnpm test` itself no longer needs a real `.env`: `.env.test` (committed, non-secret placeholder values) is loaded via `--env-file=.env.test` in the `test` script, so `envConfig.ts`'s required vars (`DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `DB_USER`, `LECTERN_URL`) resolve without a developer's local `.env` present
standalone: yes

`buildSequencingFilesMetadata` (`src/submission/fileValidation.ts`) reads `env.SEQUENCING_SUBMISSION_FILENAME_IDENTIFIER_COLUMN` directly instead of receiving it as a parameter, violating this project's own "library code must not read from the environment" constraint and blocking a clean, deterministic unit test of its env-dependent branches
fix: thread the identifier column through as a function parameter (the caller already reads it from `env` once), the same way `fileNameIdentifier` is already passed into `buildSongSubmissionPayload`
standalone: yes

`handleSequencingMetadataSubmission` (`src/submission/submissionHandler.ts`) fetches a Submission's clinical records via `getSubmissionDetailsById` with `pageSize` set to the full record count, i.e. one unbounded query per append call. Raised during review of the sequencing-metadata-append feature since it's the same class of problem ("large submission") that motivates this feature in the first place. Per Lyric's current storage model, this isn't actually fixable here: Lyric stores a Submission's data as a single JSONB column, so there's no partial-fetch to page or stream against
fix: revisit once the Lyric dependency ships the version that gives more granular control over Submission data storage; until then there's no code change to make on this side
standalone: yes
