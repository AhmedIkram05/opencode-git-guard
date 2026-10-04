# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.0.1]

- Docs: npm version/downloads/node badges, install methods, license section.

## [1.0.0]

- First stable release: opencode plugin denying known-destructive git
  variants (`push --force`, `reset --hard`, `clean -fd`, `checkout .`, …)
  while letting safe commands pass through to the permission layer.
- `OPENCODE_GIT_GUARD_DISABLE=1` escape hatch for legitimate one-offs.
- 70-case self-check (`npm test`), CI + publish + release workflows.
- MIT license.
