---
description: "Antigravity subagent: drive the official Google Antigravity CLI (agy) as a one-shot coding subagent in DeepSeek Harness (subagent_antigravity), including Gemini 4 Argon on an Antigravity subscription."
kind: "package-bundle"
---

# dsh-subagent-antigravity

English | [中文](README.zh.md)

Adds an **Antigravity subagent** to DeepSeek Harness (DSH): a parent session can
call `subagent_antigravity` to run the official Google Antigravity CLI (`agy`) as
a fresh coding agent inside the parent workspace — it edits files, runs commands,
and returns only its final answer.

It has the same shape as the official Codex subagent (`subagent_codex`) and the
Claude Code subagent (`subagent_claude_code`), but the backend is Antigravity, so
it needs **no separate Gemini API key**: it uses your signed-in Antigravity Google
account subscription and can drive **Gemini 4 Argon** (`gemini-4-argon-low/medium/high`).

> Community plugin; not affiliated with Google. The Antigravity CLI is Google's
> official CLI — this plugin only drives it from DSH.

## Why this plugin exists

- **Gemini CLI cannot use Gemini 4 yet.** Gemini CLI 0.64 tops out at
  `gemini-3.8-flash` / `gemini-3.1-pro-preview`; the Gemini 4 support request
  (google-gemini/gemini-cli#29689) is still open, and Gemini 4 is not a public API
  model. Gemini 4 Argon is currently offered through Antigravity for Google AI
  Pro / Ultra subscribers, and `agy models` lists what your account can use.
- So "call Gemini 4 like Codex" means driving the **Antigravity CLI**, not the
  Gemini CLI. (A sibling plugin, `dsh-subagent-gemini`, covers the Gemini CLI
  route and will support Gemini 4 once Google ships it there.)

## How it works

```
parent session (DeepSeek model)
   │  calls tool subagent_antigravity({ description, prompt })
   ▼
DSH subagent seam (ctx.subagents)
   │  provider: antigravity (registered by this plugin)
   ▼
run layer: spawn agy --print --output-format stream-json
   │  parse NDJSON events (init / step_update / result), keep the final answer
   ▼
agy (separate process, parent cwd, your Antigravity sign-in and subscription)
   │  uses Antigravity's own tools (files, terminal, browser, MCP …)
   ▼
final answer → parent conversation
```

One delegation = one fresh process, one turn, final answer only. The child's
reasoning, tool traffic and stderr never enter the parent conversation; failures
return fixed stage/category diagnostics instead of raw stderr or credentials.

## Requirements

| Dependency | Version / notes |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` series (`ctx.subagents` + `@deepseek-ai/dsh-tool-subagent`) |
| Node.js | `^22.19.0` or `>=24` |
| Google Antigravity CLI (`agy`) | official CLI, 1.4+; `agy --version` must answer |
| Antigravity account | signed in through the Antigravity app or CLI (AI Pro / Ultra for Gemini 4 Argon) |

Install the official CLI:

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
# Windows (PowerShell)
# irm https://antigravity.google/cli/install.ps1 | iex

agy --version      # expect 1.4.2+
agy models         # lists the models your account can use (incl. gemini-4-argon-*)
```

Sign-in is shared across local Antigravity surfaces; if the app is already signed
in, `agy` normally works directly. Otherwise run `agy` once and complete the
Google sign-in. Enterprise accounts can use `AGY_ADC_AUTH=true` with
`gcloud auth application-default login`, or the `GEMINI_API_KEY` mode (note: an
API key cannot reach Gemini 4 unless that key itself is entitled).

## Install the plugin

**From the DSH plugin market (recommended):** search for
`dsh-subagent-antigravity`, install and enable it.

**From the command line:**

```bash
dsh plugin --profile desktop add dsh-subagent-antigravity
```

Then add the package to that profile's `package.json` → `dsh.profile.bundles`
and restart (or let the profile recompose):

```json
"dsh": {
  "profile": {
    "bundles": ["…", "dsh-subagent-antigravity"]
  }
}
```

Once enabled, every agent sees the global tool `subagent_antigravity` (a running
session picks it up on its next request).

## Usage

```json
{
  "name": "subagent_antigravity",
  "arguments": {
    "description": "Fix login timeout",
    "prompt": "In the workspace, raise the login request timeout from 5s to 15s, run the related tests, and reply only with what you changed and the test result."
  }
}
```

- `description` — 3–5 word task name;
- `prompt` — a **self-contained** task; the child cannot see the parent conversation.

## Configuration

Override the `subagent-antigravity` entry's `config` in a profile patch:

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `antigravity` | name registered on `ctx.subagents`; unique per profile |
| `command` | empty (auto-detect) | path to `agy`; empty searches `PATH`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, … |
| `model` | `gemini-4-argon-medium` | fixed model; `agy models` lists the live catalogue (`gemini-4-argon-*`, `gemini-3.8-flash-*`, `claude-*-5-5-*`, …) |
| `effort` | empty | `low` / `medium` / `high` / `xhigh` / `max` |
| `mode` | empty | `accept-edits` / `auto` / `plan` (read-only) |
| `skipPermissions` | `true` | pass `--dangerously-skip-permissions` so an unattended child can edit/run; with `false`, headless cannot prompt and write tools are auto-denied |
| `sandbox` | `false` | pass `--sandbox` (the CLI's terminal sandbox) |
| `timeoutMs` | `900000` (15 min) | overall wall-clock budget per delegation |
| `disposeGraceMs` | `5000` | SIGTERM→SIGKILL escalation grace |
| `env` | `{}` | extra child environment variables |
| `extraArgs` | `[]` | extra CLI arguments for forward compatibility |

Example — Gemini 4 Argon High, read-only:

```yaml
- id: subagent-antigravity
  config:
    model: gemini-4-argon-high
    mode: plan
    skipPermissions: false
```

## Security and permissions

- The default `skipPermissions: true` is **unattended**: the child may edit files
  and run commands without a human approval prompt. That is what makes delegated
  coding tasks possible; use it in trusted workspaces and review `git diff`.
- For read-only delegation use `mode: plan` with `skipPermissions: false`; headless
  mode cannot prompt, so write attempts are auto-denied and reported as a
  `permission` failure instead of silently continuing.
- The child is a separate process: DSH's subprocess seam scrubs credential-like
  variables from the parent environment; only `env` entries are forwarded.
- No telemetry. No credential is read, logged or returned by this plugin; the
  Antigravity sign-in is managed by the CLI itself.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Antigravity CLI (agy) was not found` | run the official install script and verify `agy --version` |
| diagnostic `category: auth` | not signed in: run `agy` once and complete the Google sign-in |
| diagnostic `category: permission` | headless cannot prompt: keep `skipPermissions: true` or use `mode: plan` |
| diagnostic `category: quota` | the model has no quota/rate left for this account right now |
| diagnostic `category: timeout` | raise `timeoutMs` or split the task |
| want to verify the machine | `npm run smoke` in the plugin checkout (one small Antigravity request) |

## Compatibility and development

- Unit tests: `npm test` (34 cases: config normalization, CLI discovery, and the
  run layer's event parsing, timeout, cancellation, permission and failure mapping);
- End-to-end self-check: `npm run smoke` (real `agy` + Gemini 4 Argon, expects PONG);
- No private DSH packages are imported (only `@deepseek-ai/schemastery` for config
  validation), so the run layer is unit-testable outside the host;
- Reference implementation: official `@deepseek-ai/dsh-subagent-codex` (the
  one-process-per-run, one-turn, final-answer, safe-diagnostics contract).

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-subagent-antigravity
```

Then remove `dsh-subagent-antigravity` from the profile's `dsh.profile.bundles` and restart.

## License

MIT. Antigravity and its name belong to Google; this project is not affiliated with Google.
