# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-10-19

### Added

- `subagent_antigravity` delegation tool: runs the official Google Antigravity
  CLI (`agy --print --output-format stream-json`) as a one-shot, out-of-process
  coding subagent in the parent workspace.
- Provider registered as `antigravity` on `ctx.subagents`; out-of-process
  capability advertisement, no inherited parent context.
- Automatic `agy` discovery: configured path, `PATH`, and the official installer
  location `~/.local/bin` plus Homebrew/npm-global fallbacks; Windows candidate
  names (`agy.exe`, `agy.cmd`, `agy.bat`).
- Configuration schema with defaults: `providerName`, `command`, `model`
  (default `gemini-4-argon-medium`), `effort`, `mode`, `skipPermissions`,
  `sandbox`, `timeoutMs`, `disposeGraceMs`, `env`, `extraArgs`.
- Run layer: NDJSON event parsing (`init` / `step_update` / `result`), final
  answer selection, terminal status mapping, timeout and cancellation handling,
  permission-denied detection, and fixed safe diagnostics that never carry
  stderr, paths or credentials.
- Bilingual documentation (English / 中文), `npm run smoke` end-to-end check
  against a real Antigravity CLI, and 34 unit tests.
