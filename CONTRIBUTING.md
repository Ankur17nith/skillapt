# Contributing to skillapt

Thanks for helping! `skillapt` is the CLI of a three-repository project:

| Repository | What it is |
| :--- | :--- |
| [skillapt](https://github.com/Ankur17nith/skillapt) | the CLI (this repo) |
| [skillapt-registry](https://github.com/Ankur17nith/skillapt-registry) | registry API (Cloudflare Workers, D1, R2) |
| [skillapt-web](https://github.com/Ankur17nith/skillapt-web) | website and docs |

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). **Security issues must not be filed
as public issues**; see [SECURITY.md](SECURITY.md).

## Getting set up

Requirements: Node.js **22.12+** and npm.

```bash
git clone https://github.com/Ankur17nith/skillapt.git
cd skillapt
npm ci
npm run typecheck
npm test
npm run build
node dist/cli.js --help
```

The test suite is fully offline (GitHub and the registry are mocked), so it should pass on a clean checkout.
`npm test` runs `npm run build` first because some tests execute `dist/cli.js`.

### Project layout

```
src/cli.ts          command wiring (commander)
src/commands/       one file per command
src/lib/            registry client, extraction, validation, lockfile, targets, auth, config
tests/              unit and e2e tests; tests/security/ holds regression tests for past vulnerabilities
docs/               SPEC.md and openapi.yaml (the CLI <-> registry contract)
```

## Making a change

1. Open an issue first for anything non-trivial.
2. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
3. Keep commits small and focused. We use [Conventional Commits](https://www.conventionalcommits.org):
   `fix(security): ...`, `feat(install): ...`, `docs: ...`, `test: ...`, `ci: ...`, `chore: ...`.
4. Add or update tests. **Every security fix needs a regression test** in `tests/security/` that fails without the fix.
5. Update `README.md`, `docs/SPEC.md` and `CHANGELOG.md` (under *Unreleased*) when behaviour changes.
6. Run `npm run typecheck && npm test` before pushing.

### Security-sensitive code

Treat these inputs as untrusted: tarballs, `SKILL.md`/`skill.json`, `skills.json`, **`skills.lock.json`**,
registry responses, GitHub responses and environment variables. Paths derived from them must go through
`assertInside()`; never pass them to a shell; never delete a path just because a file says so.

### Contract with the registry

Registry behaviour is defined by `docs/openapi.yaml`. Changes to request/response shapes must be made in both
this repo and `skillapt-registry`; the registry repo runs a CLI conformance job against the CLI.

## Pull request checklist

- [ ] Typecheck, tests and build pass locally (`npm run typecheck && npm test && npm run build`)
- [ ] Tests added/updated (security fixes include a failing-before regression test)
- [ ] Docs and `CHANGELOG.md` (*Unreleased*) updated
- [ ] No secrets, tokens or personal data in code, tests or fixtures
- [ ] Commits follow Conventional Commits

## Releasing (maintainers)

1. Update `version` in `package.json`, move *Unreleased* entries in `CHANGELOG.md` under the new version and date.
2. Merge to `main` once CI is green.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The *Release* workflow verifies the tag matches `package.json`, runs audit/typecheck/tests and publishes to npm with
   provenance, **only if** the `NPM_TOKEN` repository secret is configured.
5. Create a GitHub release from the tag using the changelog entry.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
