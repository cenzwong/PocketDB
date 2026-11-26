# ADR-016: Package distribution and versioning

- Status: accepted for the initial npm package path; first public release remains gated
- Date: 2026-11-24
- Reversibility: medium before a public package is consumed; low after stable releases

## Context

PocketDB currently ships a static web app from a pnpm TypeScript monorepo. The workspace has separate client, protocol, transport, runtime and engine packages, but those packages are private and export source TypeScript. The CLI and native protocol bridges are future work. Publishing the current workspace as-is would expose unstable implementation boundaries and unresolved workspace dependencies.

The handoff requires package publication to wait for explicit release approval. The Apache-2.0 choice in ADR-017 also requires confirming copyright ownership and auditing the exact dependencies and generated files included in each distributed artifact.

## Decision

### Public boundaries

- Keep the static web application and its assets on the existing GitHub Pages path; its deployment does not publish SDK packages.
- The first SDK package boundary is `@pocketdb/client`. It is the supported consumer entry point and must expose built JavaScript, declarations and only documented public subpaths. Protocol, transport, runtime and engine packages remain private implementation dependencies unless an approved consumer need justifies a separately supported public API.
- When implemented, publish the command-line tool as `pocketdb` with the `pocketdb` executable. Treat PostgreSQL and RESP bridges as CLI capabilities and separately versioned packages only if their lifecycle, dependencies or consumers require independent installation. Do not create empty packages for planned Python or MCP surfaces.
- Keep package names under the `@pocketdb` scope, except the user-facing `pocketdb` CLI package. Reserve and verify names before the first release.

### Versions and compatibility

- Version independently by published package, using SemVer. A package's public API and documented runtime support define its compatibility contract. Internal package version equality is not a compatibility guarantee.
- Use `0.y.z` while a package is experimental: compatible fixes increment `z`; a breaking public API change increments `y` and resets `z`. Declare `1.0.0` only after the API, runtime matrix and migration policy are approved.
- Use explicit prerelease identifiers (`0.y.z-alpha.n`, `-beta.n`, `-rc.n`) for installable previews. Publish previews with the `next` dist-tag; stable releases alone receive `latest`. Consumers must opt into prereleases.
- Each public package documents supported Node versions and browser environments as applicable. Changes to that support matrix are compatibility changes and must be reflected in release notes and CI. Browser claims remain limited to evidence recorded by ADR-014 and TASK-041.
- SDK releases consume released package versions, never `workspace:*` references. A coordinated release may publish several packages, but each package keeps its own version and changelog entry.

### Repeatable artifact and approval path

1. Build from a clean, locked checkout with the pinned Node and pnpm versions. Run checks, tests and builds required by CI, plus the package artifact smoke workflow.
2. Review the exact tarball file list and metadata, install each candidate tarball into a clean temporary consumer, and execute a consumer smoke check. Retain the tarball checksum and run evidence with the release record.
3. Before a first release, confirm package-name ownership, copyright holder, Apache-2.0 notices, dependency/license audit, compatibility claims, README and changelog.
4. Create a versioned release candidate and obtain explicit maintainer approval through a protected `npm` release environment. Registry publication is a separate manual release action after approval; pull request, branch, static-site and ordinary CI workflows have no npm publishing credentials.
5. Publish stable releases with the `latest` tag and prereleases with `next`, using trusted CI identity/provenance where the selected registry workflow supports it. Verify the published version and install it from the registry before announcing the release.

The current workflow implements local pack-and-install verification only. No registry publish workflow, credentials, public package metadata or release environment is configured by this decision. Those are added only when a package is made release-ready, with approval rules enforced by the repository's protected environment.

## Alternatives considered

- Publish every workspace package in lockstep: rejected because it exposes implementation packages as supported APIs and couples unrelated release cadence.
- Publish the current TypeScript source packages immediately: rejected because source exports and `workspace:*` dependencies are not a finished install contract.
- Make packages stable before the API settles: rejected because SemVer's stable compatibility promise would be premature.
- Couple npm publication to every CI run: rejected because publication requires human review of licensing, compatibility and the exact artifact.

## Consequences

- Public SDK packaging requires a build step that emits executable JavaScript and declarations and rewrites internal workspace dependencies to released versions.
- Package release checks must test tarballs outside the monorepo so workspace links cannot hide missing files or dependencies.
- Public package approvals are distinct from GitHub Pages deployment approvals.
- The initial protocol-package smoke is a packaging mechanism proof, not evidence that the full SDK is ready for publication.

## Evidence

- [Engineering handoff, release and package requirements](../handoff.md)
- [ADR-003: TypeScript workspace and package boundaries](ADR-003-typescript-monorepo.md)
- [ADR-014: Browser support](ADR-014-browser-support.md)
- [ADR-017: Open-source license](ADR-017-open-source-license.md)
- [pnpm pack documentation](https://pnpm.io/cli/pack)
- [npm publish dry-run and release options](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
