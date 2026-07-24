# Tech debt

Known issues, scope-adjacent problems, and deferred work. See `CLAUDE.md`/`AGENTS.md` § Tech-debt entry format.

---

No automated test suite exists in this repository
fix: introduce `node:test`-based BDD tests co-located with source files (see `CLAUDE.md`/`AGENTS.md` § Testing) starting with the next feature or bug fix touched, rather than a single big backfill effort; add a `test` script to `package.json` once the first test file exists
standalone: yes
