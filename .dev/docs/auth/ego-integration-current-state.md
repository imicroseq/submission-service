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
6. Separately, the write controllers (`src/controllers/submission/submit.ts:56`, `commit.ts:60`, `editData.ts:65`) call `hasUserWriteAccess(organization, user)` (`common/auth.ts`) as a second, per-organization check. Read controllers do not do an equivalent per-organization check.

`shouldBypassAuth` (`common/auth.ts`) has two independent ways to return `true`: `AUTH_ENABLED=false` globally, or the request's HTTP method not being in `AUTH_PROTECT_METHODS` (default list is `POST,PUT,DELETE`, so `GET` bypasses auth by default configuration even when `AUTH_ENABLED=true`).

## What "optional" actually means

`AGENTS.md` describes EGO as "optionally EGO (auth)." In practice: `AUTH_ENABLED=false` is a true no-op, `authMiddleware` calls `next()` immediately, no user object is ever attached. This is a genuine feature flag, not a stub. On top of that flag, `AUTH_PROTECT_METHODS` narrows enforcement further by method regardless of the flag's value.

## Where enforcement actually applies

Directly wrapped with `authMiddleware` (`src/routers/submission.ts:40-43`, `src/routers/submittedData.ts:37-40`): every route this repo defines in those two routers.

Not gated by this repo's own middleware at all: `/health` and `/api-docs` (`src/server.ts:58,68`), unauthenticated by design.

Mounted with no `authMiddleware` in `server.ts` (lines 61-65): `/audit`, `/category`, `/dictionary` → `lyricProvider.routers.*`, and the fallthrough `router.use('', lyricProvider.routers.submission)` / `.submittedData` inside `submission.ts:49` and `submittedData.ts:42`. These run inside `@overture-stack/lyric` library code. Because `provider.ts` passes the same `verifyToken`, `AUTH_ENABLED`, and `AUTH_PROTECT_METHODS` into Lyric's own `AppConfig.auth`, these routes very likely get the same EGO check applied internally by Lyric, using the same flags, not a separate or absent one. This wasn't verified against Lyric's own router source in this pass, flagging it as an assumption rather than a confirmed fact: worth checking `@overture-stack/lyric`'s source directly before relying on it for a security-relevant design decision.

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

None recorded at initial writing. Superseded by a cross-project review with Arranger and Usher (2026-08-19), which surfaced five concrete findings now filed in `.dev/tech-debt.md`: no read authorization at any layer by default configuration (live, not hypothetical), a cross-service token-confusion risk from the missing `iss`/`aud` check, the write-authorization seam being a followed convention rather than a structural requirement, the `allowedReadOrganizations` empty-array ambiguity, and a low-priority verify-then-decode fragility in `verifyEgoJwt.ts`. `.dev/roadmap.md` still has no active or parked initiatives; the read-authorization intent question (world-readable by design, or an unfinished feature) needs a developer decision before it becomes one.
