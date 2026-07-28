# Sequencing metadata submission without a new data file

`POST /submission/category/{categoryId}/data` accepts a request with no `submissionFile`, as long as `sequencingMetadata` is provided and the caller already has an active Submission for that organization. In that case the request attaches the given sequencing files to the existing active Submission instead of creating new clinical data records. See [`docs`](https://github.com/imicroseq/submission-service/blob/main/src/api-docs/submission-api.yml) for the consumer-facing request/response shape.

## Why this exists

Sequencing files often arrive after their clinical data file: an operator may submit clinical records together with some of the sequencing files for those same records. Before this change, every submission required a .csv file along with its sequencing files, and it was not possible to append sequencing files to records that had already been submitted.

## How it works

1. `src/controllers/submission/submit.ts` looks up the caller's active Submission for the organization via `lyricProvider.services.submission.getActiveSubmissionByOrganization`. This already filters to submissions with an open status (`OPEN`/`VALID`/`INVALID`) and to the requesting user, so no extra active/ownership check is needed.
2. If there's no active Submission, or no `sequencingMetadata` was provided, the request fails the same way as before: `submissionFile` is required.
3. Otherwise `src/submission/submissionHandler.ts`'s `handleSequencingMetadataSubmission` fetches the active Submission's already-staged clinical records via `getSubmissionDetailsById` (`INSERTS` only, filtered to the request's `entityName`), matches them against the provided sequencing metadata, and submits the resulting payload(s) to Song.
4. The response's `submissionManifest` merges the Submission's already-uploaded files (from `buildSubmissionFileMetadata`) with the newly submitted ones, so it reflects the full current state of the Submission's files, not just what this request added.

## Design decisions

**Why `INSERTS` only, not `UPDATES`.** Sequencing files are matched against clinical records by an identifier column (`SEQUENCING_SUBMISSION_FILENAME_IDENTIFIER_COLUMN`) using flat `Record<string, string>` comparisons. That's the same shape the original file-upload path already used for freshly parsed records, all of which are inserts. Restricting to `INSERTS` keeps the matching behavior identical between the two paths rather than introducing a second comparison shape for edited records.

**Why the Song submission call was refactored to take a `batchName` string instead of an `Express.Multer.File`.** The file-less path has no `Express.Multer.File` to pass, and the file object was only ever used for its `.originalname` in error messages. Passing the batch name directly avoids inventing a placeholder file object for a code path that doesn't have one.

**Why the pure matching logic lives in `src/submission/sequencingPayload.ts`, separate from `submissionHandler.ts`.** `submissionHandler.ts` imports `@/core/provider.js` for `lyricProvider`, and that module's `provider()` factory eagerly opens a Postgres connection and spins up a worker pool as a side effect of being imported (not lazily, on first use). That makes `submissionHandler.ts` untestable without a live Postgres instance: importing it for a `node:test` run hangs indefinitely rather than failing fast. `buildSongSubmissionPayload` and `extractInsertRecordValues` are the two genuinely pure pieces of the sequencing-metadata-matching logic (no I/O beyond reading a static JSON template from disk), so they live in a module that doesn't import the provider, and both `submissionHandler.ts` and `src/submission/sequencingPayload.test.ts` import them from there. See `.dev/tech-debt.md` for the broader testing gaps this doesn't resolve (the orchestration layer and controllers still need either a real test environment or a mocking layer).
