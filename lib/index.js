/**
 * Antigravity subagent provider for DeepSeek Harness.
 *
 * Registers one `ctx.subagents` provider that runs the official Google
 * Antigravity CLI (`agy --print`) as a fresh one-shot coding child, and pairs it
 * with the generic delegation tool as `subagent_antigravity`. The child keeps
 * its own model, tools and permission mode inside the parent workspace; only its
 * final answer returns to the parent conversation.
 *
 * The provider is an out-of-process backend, so it advertises no parent-enforced
 * start capabilities and does not inherit the parent conversation — the same
 * contract the official Codex / Claude Code / ACP subagent backends use.
 *
 * @module dsh-subagent-antigravity
 */

import { Config, buildAntigravityArgs, resolveConfig } from './config.js'
import { resolveAgyCommand } from './resolve.js'
import { promptText, startAntigravityRun } from './run.js'

/** Plugin id used by the loader and diagnostics. */
export const name = 'subagent-antigravity'
/** Services the provider uses: the subagent registry and the process seam. */
export const inject = ['subagents', 'subprocess']

export { Config }

/** Capability advertisement of an out-of-process backend: none. */
const NO_START_CAPABILITIES = Object.freeze({
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
})

/** One registered Antigravity provider. */
class AntigravityProvider {
    /**
     * @param {string} providerName - registry name.
     * @param {object} ctx - plugin context.
     * @param {ReturnType<typeof resolveConfig> & {commandPath: string}} config - resolved settings.
     */
    constructor(providerName, ctx, config) {
        this.name = providerName
        this.ctx = ctx
        this.config = config
        this.capabilities = NO_START_CAPABILITIES
        this.inheritsParentContext = false
    }

    /**
     * Start one delegation in a fresh Antigravity CLI process.
     *
     * @param {{cwd?: string, prompt: unknown, signal: AbortSignal}} request - the seam start request.
     * @returns {Promise<object>} the published run handle.
     */
    async start(request) {
        const prompt = promptText(request.prompt)
        const cwd = typeof request.cwd === 'string' && request.cwd !== '' ? request.cwd : process.cwd()
        return startAntigravityRun(request, {
            command: this.config.commandPath,
            args: buildAntigravityArgs(this.config, prompt),
            cwd,
            env: this.config.env,
            graceMs: this.config.disposeGraceMs,
            timeoutMs: this.config.timeoutMs,
            spawn: spec => this.ctx.subprocess.spawn(spec),
            onError: (error, stopReason) => {
                this.ctx.logger?.warn?.(`subagent-antigravity "${this.name}": child run failed (${stopReason}): ${error.message}`)
            },
        })
    }
}

/**
 * Mount the Antigravity provider.
 *
 * Load-time checks are advisory: a missing CLI must not stop the host from
 * booting, because the operator can install it and reload the profile. The
 * warning carries the exact install command; a delegation fails later with the
 * seam's safe diagnostic until the machine is ready.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} [rawConfig] - profile configuration.
 */
export function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig)
    const resolution = resolveAgyCommand({ command: config.command })
    if (resolution.ok) {
        ctx.logger?.debug?.(`dsh-subagent-antigravity: using Antigravity CLI at ${resolution.command} (${resolution.source})`)
    } else {
        ctx.logger?.warn?.(`dsh-subagent-antigravity: ${resolution.error}`)
    }
    const providerConfig = {
        ...config,
        commandPath: resolution.ok ? resolution.command : 'agy',
    }
    ctx.subagents.registerProvider(new AntigravityProvider(providerConfig.providerName, ctx, providerConfig))
}

export { buildAntigravityArgs, resolveConfig } from './config.js'
export { resolveAgyCommand } from './resolve.js'
export { startAntigravityRun } from './run.js'
