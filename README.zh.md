---
description: "Antigravity 子智能体：把 Google 官方 Antigravity CLI（agy）作为 DeepSeek Harness 的一次性编码子智能体（subagent_antigravity），可直接使用 Gemini 4 Argon 等 Antigravity 订阅模型。"
kind: "package-bundle"
---

# dsh-subagent-antigravity

[English](README.md) | 中文

给 DeepSeek Harness 加一个 **Antigravity 子智能体**：父会话里的模型可以调用 `subagent_antigravity`，
在独立进程里起一个 **Google 官方 Antigravity CLI（`agy`）** 编码智能体，在父会话的工作目录里
自主读写文件、执行命令，只把最终答案带回父会话。

它和官方 Codex 子智能体（`subagent_codex`）、Claude Code 子智能体（`subagent_claude_code`）是同一形态，
但后端换成 Antigravity —— 因此**不需要单独的 Gemini API key**，直接使用你已登录的 Antigravity
Google 账号订阅额度，并且**可以用上 Gemini 4 Argon**（`gemini-4-argon-low/medium/high`）。

> 这是一个社区插件，与 Google 无关。Antigravity CLI 是 Google 的官方 CLI，本插件只负责在 DSH 里安全地驱动它。

## 为什么需要它

- **Gemini CLI 目前用不了 Gemini 4**：Gemini CLI 0.64 的模型清单最高到 `gemini-3.8-flash` /
  `gemini-3.1-pro-preview`，Gemini 4 的支持 issue（google-gemini/gemini-cli#29689）仍未合并；
  Gemini 4 API 也尚未作为公开 API 提供。
- **Antigravity 已经支持 Gemini 4 Argon**：Google 官方公告 Gemini 4 Argon 面向 Google AI Pro / Ultra
  订阅用户在 Antigravity（App / CLI / IDE / SDK）提供。`agy models` 会实时列出你账号可用的模型，
  包括 `gemini-4-argon-*`、Gemini 3.8 Flash、Claude Opus/Sonnet 5.5、GPT-OSS 等。
- 所以"像 Codex 一样调用 Gemini 4"的正确后端是 **Antigravity CLI**，而不是 Gemini CLI。
  （如果你更希望接 Gemini CLI，另有 `dsh-subagent-gemini` 插件，等 Gemini CLI 支持 Gemini 4 后同样可用。）

## 工作原理

```
父会话（DeepSeek 模型）
   │  调用工具 subagent_antigravity({ description, prompt })
   ▼
DSH subagent seam (ctx.subagents)
   │  provider: antigravity（本插件注册）
   ▼
本插件 run 层：spawn agy --print --output-format stream-json
   │  解析 NDJSON 事件（init / step_update / result），只取最终答案
   ▼
agy（独立进程，父会话 cwd，使用你的 Antigravity 登录态与订阅额度）
   │  使用 Antigravity 自带工具（文件编辑 / 终端 / 浏览器 / MCP …）
   ▼
最终答案 → 回到父会话
```

一次委派 = 一个全新进程、一个轮次、只回最终答案；子进程的思考、工具调用、stderr 都不会进入父会话。
失败只返回固定的阶段/类别诊断，不泄露 stderr、路径或凭据。

## 环境要求

| 依赖 | 版本 / 说明 |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` 系列（提供 `ctx.subagents` 与 `@deepseek-ai/dsh-tool-subagent`） |
| Node.js | `^22.19.0` 或 `>=24` |
| Google Antigravity CLI (`agy`) | 官方 CLI，1.4+；`agy --version` 能输出版本号即可 |
| Antigravity 账号 | 已在 Antigravity App 或 CLI 登录 Google 账号（AI Pro / Ultra 才有 Gemini 4 Argon） |

安装官方 CLI：

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
# Windows (PowerShell)
# irm https://antigravity.google/cli/install.ps1 | iex

agy --version      # 应输出版本号（1.4.2+）
agy models         # 应列出你账号可用的模型（含 gemini-4-argon-*）
```

登录：Antigravity 的登录态在本地各入口间共享；如果 App 已登录，`agy` 通常直接可用。
需要时在终端运行一次 `agy` 完成 Google 登录即可。企业账号可用 `AGY_ADC_AUTH=true` +
`gcloud auth application-default login`，或用 `GEMINI_API_KEY` 走 API key 模式（注意 API key 模式
用不了 Gemini 4，除非该 API key 本身有 Gemini 4 权限）。

## 安装插件

**方式一：DSH 插件市场（推荐）** —— 在 DSH 插件页搜索 `dsh-subagent-antigravity` 安装并启用。

**方式二：命令行**

```bash
dsh plugin --profile desktop add dsh-subagent-antigravity
```

然后把包名加进该 profile 的 `package.json` → `dsh.profile.bundles` 数组，重启或让 profile 重新组合：

```json
"dsh": {
  "profile": {
    "bundles": ["…", "dsh-subagent-antigravity"]
  }
}
```

启用后，所有智能体都会看到全局工具 `subagent_antigravity`（正在运行的会话在下一次请求时生效）。

## 使用

```json
{
  "name": "subagent_antigravity",
  "arguments": {
    "description": "升级登录超时",
    "prompt": "在工作区里把登录请求的超时从 5s 改成 15s，跑相关测试，最后只回复你改了什么和测试结果。"
  }
}
```

- `description`：3–5 个词的任务名；
- `prompt`：**自包含**的任务说明 —— 子智能体看不到父会话上下文，路径、约束、验收标准都要写清楚。

## 配置项

在 profile patch 中覆盖 `subagent-antigravity` 条目的 `config`：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `providerName` | `antigravity` | 注册到 `ctx.subagents` 的名字，同 profile 内唯一 |
| `command` | 空（自动查找） | `agy` 可执行文件路径；留空按 `PATH` → `~/.local/bin` → `/opt/homebrew/bin` → `/usr/local/bin` 查找 |
| `model` | `gemini-4-argon-medium` | 固定模型；用 `agy models` 查看完整清单（`gemini-4-argon-low/medium/high`、`gemini-3.8-flash-*`、`claude-*-5-5-*` 等） |
| `effort` | 空 | 推理强度：`low` / `medium` / `high` / `xhigh` / `max` |
| `mode` | 空 | 执行模式：`accept-edits` / `auto` / `plan`（`plan` 为只读） |
| `skipPermissions` | `true` | 传 `--dangerously-skip-permissions`，让子智能体在无人值守下自主改文件/跑命令；设为 `false` 时 headless 无法弹审批，写操作会被自动拒绝 |
| `sandbox` | `false` | 传 `--sandbox`，启用 CLI 自带终端沙箱 |
| `timeoutMs` | `900000`（15 分钟） | 单次委派的整体超时 |
| `disposeGraceMs` | `5000` | 终止进程时的 SIGTERM→SIGKILL 宽限 |
| `env` | `{}` | 追加给子进程的环境变量 |
| `extraArgs` | `[]` | 追加的 CLI 参数，供未来特性兼容 |

示例：固定 Gemini 4 Argon High、只读模式

```yaml
- id: subagent-antigravity
  config:
    model: gemini-4-argon-high
    mode: plan
    skipPermissions: false
```

## 安全与权限

- 默认 `skipPermissions: true` 意味着 **无人值守**：子智能体可以自主修改工作区文件、执行命令。
  这是委派编码任务的前提；请只在可信工作区使用，任务结束后检查 `git diff`。
- 想只读时用 `mode: plan` + `skipPermissions: false`（headless 模式无法人工审批，写操作会被自动拒绝并
  以 `permission` 类别报错，而不是静默继续）。
- 子智能体是独立进程：环境变量由 DSH subprocess seam 清洗后传入，只有 `env` 显式给出的变量才会进入子进程。
- 本插件不包含遥测；不读取、不记录、不回传任何凭据。登录态由 Antigravity CLI 自己管理。

## 故障排查

| 现象 | 处理 |
|---|---|
| `Antigravity CLI (agy) was not found` | 按上文运行官方安装脚本，`agy --version` 验证 |
| 失败诊断 `category: auth` | 未登录 Antigravity：在终端运行 `agy` 完成 Google 登录 |
| 失败诊断 `category: permission` | headless 无法审批：保持 `skipPermissions: true`，或用 `mode: plan` 只读 |
| 失败诊断 `category: quota` | 账号该模型额度用尽/限流，换模型或等额度刷新 |
| 失败诊断 `category: timeout` | 任务超时：调大 `timeoutMs`，或把任务拆小 |
| 想确认机器环境 | 在插件目录运行 `npm run smoke`（会消耗一次小的 Antigravity 请求） |

## 兼容性与开发

- 单元测试：`npm test`（34 个用例：配置规范化、CLI 定位、run 层事件解析/超时/取消/权限/失败映射）；
- 端到端自检：`npm run smoke`（真实 `agy` + Gemini 4 Argon，验证 PONG）；
- 不依赖任何 DSH 私有包（只依赖 `@deepseek-ai/schemastery` 做配置校验），run 层可单独测试；
- 参考实现：官方 `@deepseek-ai/dsh-subagent-codex`（一次一进程、单轮、最终答案、安全诊断的契约）。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-subagent-antigravity
```

并从 profile 的 `dsh.profile.bundles` 中移除 `dsh-subagent-antigravity` 后重启。

## 许可证

MIT。Antigravity 及其名称归 Google 所有；本项目与 Google 无关联。
