# Current EGO integration

Factual snapshot of how Overture EGO authentication and authorization works in this service today, written for the Overture-side design work replacing EGO with a shared auth controller. No proposed design here, only current state.

## Where it lives

- `src/common/envConfig.ts:53-62`: the auth-related env schema. `AUTH_ENABLED` (default `true`), `AUTH_PROTECT_METHODS` (default `POST,PUT,DELETE`, parsed into an HTTP-method array), `AUTH_PUBLIC_KEY` (RS256 public key, default empty), `AUTH_PERMISSION_ADMIN`, `AUTH_PERMISSION_PREFIX_ORG`, `AUTH_PERMISSION_SUFFIX_ORG`. A `superRefine` (`envConfig.ts:88-95`) fails validation if `AUTH_ENABLED=true` and `AUTH_PUBLIC_KEY` is blank.
- `src/middleware/verifyEgoJwt.ts`: all EGO-specific logic, JWT verification, the EGO JWT shape, and scope-string parsing.
- `src/middleware/authMiddleware.ts`: generic Express middleware, EGO-agnostic by name, delegates the actual work.
- `src/common/auth.ts`: `shouldBypassAuth` and `hasUserWriteAccess`, also generic by name.
- `src/core/provider.ts:24-30`: wires the same `verifyToken` function into Lyric's own `AppConfig.auth` (`enabled`, `customAuthHandler`, `protectedMethods`), so this repo's own Express routes and Lyric's internal routes share one verification function and one set of flags.

## Request-time flow

For a route with `authMiddleware` applied directly:

1. `authMiddleware` (`authMiddleware.ts:42`) calls `shouldBypassAuth(req.method)`. If that returns `true`, the request proceeds with no `req.user` set at all.
2. Otherwise `verifyToken(req)` (`verifyEgoJwt.ts`) runs: extract the Bearer token from the `Authorization` header, `jwt.verify` it against `AUTH_PUBLIC_KEY` with `RS256` (signature check only, no explicit `iss`/`aud` check beyond `jsonwebtoken`'s own defaults), then `jwtDecode` it into an `EgoJwtData` shape (`context.user.email`, `context.user.status`, `context.scope`).
3. `isValidTokenPayload` requires `context.user.status === 'APPROVED'`.
4. The decoded token maps into Lyric's `UserSessionResult`: `isAdmin` from an exact scope-string match against `AUTH_PERMISSION_ADMIN`; `allowedWriteOrganizations` from scopes that start with `AUTH_PERMISSION_PREFIX_ORG` and end with `AUTH_PERMISSION_SUFFIX_ORG`, with both stripped off to yield the organization name; `allowedReadOrganizations` is hardcoded to `[]`, unconditionally, read-scoping was never implemented.
5. On success, `req.user` is set and the request proceeds. On any failure, `authMiddleware` returns `401` (no token) or `403` (invalid token) directly, before the route handler runs.
6. Separately, the write controllers (`src/controllers/submission/submit.ts:59`, `commit.ts:60`, `editData.ts:65`) call `hasUserWriteAccess(organization, user)` (`common/auth.ts`) as a second, per-organization check. Read controllers do not do an equivalent per-organization check.

`shouldBypassAuth` (`common/auth.ts`) has two independent ways to return `true`: `AUTH_ENABLED=false` globally, or the request's HTTP method not being in `AUTH_PROTECT_METHODS` (default list is `POST,PUT,DELETE`, so `GET` bypasses auth by default configuration even when `AUTH_ENABLED=true`).

## What "optional" actually means

`AGENTS.md` describes EGO as "optionally EGO (auth)." In practice: `AUTH_ENABLED=false` is a true no-op, `authMiddleware` calls `next()` immediately, no user object is ever attached. This is a genuine feature flag, not a stub. On top of that flag, `AUTH_PROTECT_METHODS` narrows enforcement further by method regardless of the flag's value.

## Where enforcement actually applies

Directly wrapped with `authMiddleware` (`src/routers/submission.ts:40-43`, `src/routers/submittedData.ts:37-40`): every route this repo defines in those two routers.

Attaching `authMiddleware` to a route does not by itself authenticate it, because `shouldBypassAuth` consults the request method. So the read-side requirement has two parts that must both hold: every read route authenticates its requester whatever the method, and every read route authorizes what it returns against that requester's entitlements. The query endpoint (`byQuery`) is the natural first place to enforce the second part, since it already authenticates its requester and has a single point where a filter can be composed.

Not gated by this repo's own middleware at all: `/health` and `/api-docs` (`src/server.ts:58,68`), unauthenticated by design.

Mounted with no `authMiddleware` in `server.ts` (lines 61-65): `/audit`, `/category`, `/dictionary` → `lyricProvider.routers.*`, and the fallthrough `router.use('', lyricProvider.routers.submission)` / `.submittedData` inside `submission.ts:50` and `submittedData.ts:42`. These run inside `@overture-stack/lyric` library code. Because `provider.ts` passes the same `verifyToken`, `AUTH_ENABLED`, and `AUTH_PROTECT_METHODS` into Lyric's own `AppConfig.auth`, these routes get the same check. Verified against Lyric 0.22.0's router source: the audit, category, dictionary, submission and submitted-data routers each apply Lyric's own auth middleware, built from the `AppConfig.auth` this repo passes in, so they run the same verification function under the same `AUTH_ENABLED` and `AUTH_PROTECT_METHODS`, and skip authentication for methods outside that list exactly as this repo's middleware does, except dictionary registration and category alias changes, which require an administrator on every method while auth is enabled. So any read requirement this service adopts has to cover these routers as well as its own handlers: they inherit this service's authentication settings, and authorization over what they return is not something they add on their own.

## Caller-supplied query filters (SQON)

Relevant to authorization because a filter is the mechanism a read-side access check would most naturally use, so it matters what filter machinery already exists and who controls it.

SQON is available here through Lyric rather than through anything this repo implements: `lyricProvider.utils.convertSqonToQuery.parseSQON`, typed and validated in `src/common/validation.ts/common.ts` (`sqonSchema` is a zod custom validator that simply calls `parseSQON` inside a try/catch) and consumed at exactly one endpoint, `POST /data/category/:categoryId/organization/:organization/query` (`src/controllers/submitted-data/getSubmittedDataByQuery.ts`).

Three requirements follow for access control on that path:

- **A server-side filter is composed over the caller's.** The caller's SQON is parsed and handed to `getSubmittedDataByOrganization(..., { entityName, view, sqon })`, which is the point where an access filter has to be combined with it, never replaced by it or trusted in its place. Arranger's caller-supplied filter callback, which its access filter is composed with, is the model to follow.
- **An organization named in the request is checked against the requester's entitlements**, rather than treated as scoping on its own.
- **Filterable fields are restricted deliberately, if any should not be filterable.** Validation today is structural (`sqonSchema` accepts anything `parseSQON` accepts), so a restriction has to be added rather than assumed; an allowlist tied to the active dictionary is the obvious form.

Two facts about the dialect, for anyone evaluating a filter representation shared with Arranger. Lyric uses `fieldName`, the Arranger v3 property name, despite depending on `@overture-stack/sqon-builder@^1.1.0`; that package is deprecated in favour of `@overture-stack/sqon` in the Arranger monorepo, so the reference in this repo's own `data-api.yml` is stale even though the compatibility conclusion holds. The real constraint is the operator set: Lyric supports `in`, `gt`, `lt` plus the `and`/`or`/`not` combinators, which is narrower than Arranger's.

## The value trust boundary

Submitted record values pass through this service unsanitized: `readFile.ts` trims them and unwraps Excel quoting, nothing more; `prevalidateNewDataFile` checks headers and required-field presence, not values. Value-level validation is delegated entirely to Lectern dictionary rules, which do not constrain the contents of a free-text field.

So values arriving at Lyric's storage and query layers are caller-controlled, and this service's safety on that path rests on how the dependency constructs its queries rather than on anything here. Worth knowing when evaluating a Lyric upgrade, since it means a change in that dependency's query construction changes this service's exposure without any change here.

Recorded deliberately as a boundary to understand rather than a gap to close: sanitizing values at ingestion would be the wrong layer, corrupting legitimate submitter data to compensate for query construction that belongs downstream. Parameterization at the point of query construction is the correct control, and it is not this repo's to implement.

## Abstraction boundary

Partial chokepoint, not a clean interface. In favour of one: `verifyToken` is the single function both this repo's `authMiddleware` and Lyric's `customAuthHandler` call, and Lyric's own config type doesn't know or care that it happens to be EGO-shaped, any function matching `(req) => UserSessionResult` would satisfy it.

Against it: EGO-specific assumptions leak into three places, not hidden behind an interface.
1. `EgoJwtData`'s shape and the scope-string parsing convention (prefix/suffix org encoding, exact-match admin scope) in `verifyEgoJwt.ts` are EGO's own scope-format conventions, not an abstraction over them.
2. `hasUserWriteAccess`/`hasAdminScope` embed EGO's permission model (scopes, admin group, org prefix/suffix) directly rather than through a named interface a different auth system could implement.
3. `allowedReadOrganizations` is hardcoded empty: an incomplete mapping, not a deliberate abstraction gap.

There is no `AuthProvider` interface or strategy type anywhere. Swapping the auth system means editing `verifyEgoJwt.ts` (or replacing it), `common/auth.ts`'s permission helpers, the env schema in `envConfig.ts`, and confirming both call sites (`authMiddleware.ts` and `provider.ts`) still get a matching `UserSessionResult` shape.

## Test coverage

None. The repository's only test file is `src/submission/sequencingPayload.test.ts` (pure logic, unrelated to auth). Nothing exercises `verifyEgoJwt.ts`, `authMiddleware.ts`, or `common/auth.ts`. Per `.dev/tech-debt.md`, importing `@/core/provider.js` hangs a `node:test` run without a live Postgres connection, which would also block a test that exercises the real router/provider wiring rather than these functions in isolation.

## Existing plans

The read requirements the Usher migration has to satisfy, and the decision behind them, are in the read-authorization entry of `.dev/tech-debt.md`, alongside the other auth entries. `.dev/roadmap.md` plans characterization tests for the HTTP surface, which will show whether a Lyric upgrade or the Usher read rules change what this service returns.
