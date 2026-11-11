# Characterization tests for the HTTP surface

## What

A harness that sends a fixed set of HTTP requests to the service running on a local stack, records the responses, and compares them before and after a change. Every difference is classified as expected (documented upstream, or intended by the change) or as a regression.

## Why

- **Upgrading Lyric.** This service mounts Lyric's routers, calls its services directly, and answers errors through its error handler. Type checking catches a changed signature, but not behaviour that keeps its types: status codes, error bodies, defaults, query results. Nothing in this repository exercises HTTP today, so an upgrade can be shown to compile but not to behave the same or better.
- **Verifying the read rules for the Usher migration** (Epic 5, `imicroseq/roadmap#189`). The same harness proves them: a request without a credential receives only what Usher's baseline allows on every read route, a requester whose grants reach nothing here receives nothing, and a requester entitled to one organization never receives another organization's records or submitter identity.

## Shape

- **Stack:** Postgres and Lectern from `docker-compose.yml`. Sequencing submission to Song disabled or stubbed, since it is an external service.
- **Fixtures:** a registered dictionary; seed submissions in at least two organizations; tokens signed by a test key for an admin, for each organization, for a user with no scopes, plus requests with no token.
- **Requests:** every route the service serves, its own and the mounted Lyric routers', for each token class, including malformed bodies, oversize uploads, and `HEAD` alongside `GET`.
- **Recording:** status code, content type and body, with volatile fields (generated ids, timestamps) normalized.
- **Comparison:** record on the current version, apply the change, replay, diff, classify.
- **Test names** state what the service must do, never how a version fails.

## Constraints

- Importing the provider opens a database connection at module load (see `.dev/tech-debt.md`), so the harness runs the service as a separate process against the live stack rather than importing it.
- Verification uses a test key pair, with the service's configured public key set to its public half.
