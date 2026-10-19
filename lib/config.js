/**
 * Configuration surface of the Antigravity subagent provider.
 *
 * The bundle inserts two profile entries: this provider and the model-facing
 * delegation tool `subagent_antigravity`. Configuration stays deliberately
 * close to the Antigravity CLI's own print-mode flags so an operator can reason
 * about the child by reading `agy --help`.
 *
 * @module dsh-subagent-antigravity/config
 */

import z from '@deepseek-ai/schemastery'

/** Registry name the provider registers on `ctx.subagents`. */
export const DEFAULT_PROVIDER_NAME = 'antigravity'
/**
 * Default model. Google calls the current frontier model "Gemini 4 Argon" and
 * Antigravity exposes it as `gemini-4-argon-<effort>`; `agy models` lists the
 * live catalogue for the signed-in account.
 */
export const DEFAULT_MODEL = 'gemini-4-argon-medium'
/** Overall wall-clock budget for one delegation. */
export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
/** Grace between the process-termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 5000
/** Reasoning effort values accepted by the Antigravity CLI. */
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
/** Agent execution modes accepted by the Antigravity CLI. */
export const MODES = Object.freeze(['accept-edits', 'auto', 'plan'])

/** Deployment settings for one Antigravity subagent provider instance. */
export const Config = z.object({
    /** Registry name on `ctx.subagents`; unique per profile. */
    providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
    /**
     * Absolute path to the `agy` executable, or a bare name resolved through
     * `PATH`. Empty auto-detects `PATH` plus the usual install locations.
     */
    command: z.string().default(''),
    /** Model fixed for every delegation, e.g. `gemini-4-argon-medium`. */
    model: z.string().default(DEFAULT_MODEL),
    /** Reasoning effort forwarded as `--effort`; empty keeps the CLI default. */
    effort: z.string().default(''),
    /**
     * Execution mode forwarded as `--mode` (`accept-edits`, `auto`, `plan`);
     * empty keeps the CLI default.
     */
    mode: z.string().default(''),
    /**
     * Unattended autonomy: pass `--dangerously-skip-permissions` so the child
     * can edit files and run commands without a human approval channel, which
     * headless print mode cannot provide. Set false together with
     * `mode: plan` for a read-only child.
     */
    skipPermissions: z.boolean().default(true),
    /** Run the child in the CLI's own terminal sandbox (`--sandbox`). */
    sandbox: z.boolean().default(false),
    /** Overall wall-clock budget for one delegation, in milliseconds. */
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
    /** Grace for the SIGTERM→SIGKILL escalation after cancellation or timeout. */
    disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
    /** Extra environment variables for the child process. */
    env: z.dict(z.string()).default({}),
    /** Extra CLI arguments appended verbatim, for forward compatibility. */
    extraArgs: z.array(z.string()).default([]),
})

/** Coerce a value to a trimmed, non-empty string, else undefined. */
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** True for a positive finite number. */
function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** Normalize a raw environment dictionary, dropping non-string values. */
function environmentObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === 'string'))
}

/**
 * Resolve a raw config into the exact shape the run layer consumes.
 *
 * Total on purpose: the loader validates `Config`, but tests, programmatic
 * mounts and hand-written patch overlays can bypass it, and a wrong-typed field
 * must degrade to its default instead of failing the whole host at boot.
 *
 * @param {Record<string, unknown>} [raw] - configuration as supplied by the loader.
 * @returns {{
 *   providerName: string,
 *   command: string,
 *   model: string,
 *   effort: string,
 *   mode: string,
 *   skipPermissions: boolean,
 *   sandbox: boolean,
 *   timeoutMs: number,
 *   disposeGraceMs: number,
 *   env: Record<string, string>,
 *   extraArgs: string[],
 * }} resolved configuration.
 */
export function resolveConfig(raw = {}) {
    const source = raw !== null && typeof raw === 'object' ? raw : {}
    const effort = nonEmptyString(source.effort) ?? ''
    const mode = nonEmptyString(source.mode) ?? ''
    const extraArgs = Array.isArray(source.extraArgs) ? source.extraArgs.map(String) : []
    return {
        providerName: nonEmptyString(source.providerName) ?? DEFAULT_PROVIDER_NAME,
        command: typeof source.command === 'string' ? source.command.trim() : '',
        model: nonEmptyString(source.model) ?? DEFAULT_MODEL,
        // Unknown enum values are dropped rather than forwarded: the CLI would
        // reject the whole run, and the closed vocabulary is documented.
        effort: EFFORTS.includes(effort) ? effort : '',
        mode: MODES.includes(mode) ? mode : '',
        skipPermissions: source.skipPermissions === false ? false : true,
        sandbox: source.sandbox === true,
        timeoutMs: positiveNumber(source.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
        disposeGraceMs: positiveNumber(source.disposeGraceMs) ?? DEFAULT_DISPOSE_GRACE_MS,
        env: environmentObject(source.env),
        extraArgs,
    }
}

/**
 * Build the Antigravity CLI argument vector for one delegation.
 *
 * `--print` mode is what makes the CLI a subagent rather than a TUI; the prompt
 * travels as one argv element, so no shell quoting or injection surface exists.
 *
 * @param {ReturnType<typeof resolveConfig>} config - resolved plugin config.
 * @param {string} prompt - the task text handed to the child.
 * @returns {string[]} argv for the `agy` executable.
 */
export function buildAntigravityArgs(config, prompt) {
    const args = ['--print', prompt, '--output-format', 'stream-json']
    if (config.model !== '') args.push('--model', config.model)
    if (config.effort !== '') args.push('--effort', config.effort)
    if (config.mode !== '') args.push('--mode', config.mode)
    if (config.sandbox) args.push('--sandbox')
    if (config.skipPermissions) args.push('--dangerously-skip-permissions')
    args.push(...config.extraArgs)
    return args
}
