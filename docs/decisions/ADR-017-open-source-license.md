# ADR-017: Open-source license

- Status: accepted; final owner confirmation and distribution-specific notice review remain release prerequisites
- Date: 2026-11-24
- Reversibility: low after public distribution; confirm copyright ownership before the first release.

## Context

The handoff calls for open-source distribution. The initial workspace contains 53 development package/version pairs, with declared metadata for every installed package. Its license set includes MIT, ISC, BSD-3-Clause, Apache-2.0, MIT OR Apache-2.0 and MPL-2.0. No production dependency is currently used by the web app, and package metadata alone does not establish distribution obligations.

## Decision

Select Apache-2.0 for PocketDB source and documentation, subject to confirming the project copyright holder before publication. It permits broad reuse and includes express patent terms. Record the SPDX identifier in package metadata and retain required notices. Audit dependencies and generated artifacts in TASK-013 and release review; do not infer compatibility from this project-level choice.

## Alternatives considered

- MIT is shorter and permissive, but has no express patent license grant in its text.
- A copyleft license may impose source-distribution conditions inconsistent with the intended broad SDK and static-asset reuse.
- Delaying all license selection blocks a coherent package/workspace setup and distribution review.

## Consequences

TASK-013 adds Apache-2.0 text, package SPDX metadata and a declared-license inventory. Confirm the copyright holder and review exact notices/source obligations for dependencies included in a release artifact. If ownership or a required dependency conflicts, stop publication and obtain an explicit licensing decision before release. This decision does not constitute legal advice or a complete distribution-specific audit.

## Evidence

- [Engineering handoff, distribution goals](../handoff.md)
- [SPDX Apache-2.0 license text](https://spdx.org/licenses/Apache-2.0.html)
- [SPDX MIT license text](https://spdx.org/licenses/MIT)
