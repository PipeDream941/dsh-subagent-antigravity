# Publishing checklist

## 1. Publish the npm package

```bash
npm login                 # one-time
npm run pack:check        # verify the tarball contents
npm publish --access public
```

Before publishing, update `package.json`:

- `repository` / `homepage` — your GitHub repository (the market links to it);
- `version` — bump on every publish (see `CHANGELOG.md`).

## 2. Push the GitHub repository

The market requires (see the
[contributing guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)):

- `package.json` with the `dsh.bundle` manifest (already present);
- a `cordis.patch.yml` next to it (already present);
- real, working code — this plugin ships a config schema, CLI discovery and the
  full one-shot run layer, not just a dependency list;
- a repository **at least one day old** before submitting the market PR;
- the GitHub topic **`dsh-plugin`**.

```bash
gh repo create dsh-subagent-antigravity --public --source . --push
gh repo edit --add-topic dsh-plugin
```

## 3. Submit to the DSH plugin market

Add exactly one file to the market repository: `data/plugins/<owner>__<repo>.yml`.
A template with accurate wording is in `docs/market-entry.yml`.

```yaml
url: https://github.com/<owner>/dsh-subagent-antigravity
name: <owner>/dsh-subagent-antigravity
category: tools
description:
  en: "Runs the official Google Antigravity CLI (agy) as a one-shot coding subagent over print-mode stream-json, exposed as the subagent_antigravity delegation tool."
  zh: "把 Google 官方 Antigravity CLI（agy）作为一次性编码子智能体接入 DeepSeek Harness，提供 subagent_antigravity 委派工具。"
```

- Only `description.en` is required; `zh` is optional.
- Quote the description when it contains a colon followed by a space.
- Category `tools` fits a model-facing delegation tool; `model` is for provider
  plugins. Do not edit the generated README files by hand.
- Do not submit a pure dependency bundle; this plugin has its own behavior, which
  is what qualifies it.

## 4. Version compatibility

This plugin is CLI-driven, so it follows the Antigravity CLI rather than a DSH
subagent backend package. When a new DSH minor lands:

1. bump the `dsh` engine range and peer assumptions if the `ctx.subagents` seam changed;
2. run `npm test` and `npm run smoke` against the new host;
3. publish a new version and update the market entry if anything user-visible changed.
