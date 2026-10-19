#!/usr/bin/env node
/**
 * End-to-end smoke test for the Antigravity subagent data path.
 *
 * It resolves `agy` exactly like the provider does, runs one real headless
 * delegation through the same run layer the host uses, and prints the final
 * answer or a safe failure diagnostic. No DSH host is needed.
 *
 *   npm run smoke
 *   npm run smoke -- --model gemini-4-argon-high
 *   npm run smoke -- --command /path/to/agy --json
 *
 * Exit codes: 0 = PASS, 1 = the run failed, 2 = the machine is not set up
 * (CLI missing). The script consumes one small real Antigravity request.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveAgyCommand } from '../lib/resolve.js'
import { buildAntigravityArgs, resolveConfig } from '../lib/config.js'
import { startAntigravityRun } from '../lib/run.js'

/** Parse the tiny CLI surface without a dependency. */
function parseArguments(argv) {
    const options = { command: '', model: '', cwd: join(tmpdir(), 'dsh-subagent-antigravity-smoke'), json: false }
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--json') options.json = true
        else if (argv[index] === '--command' && argv[index + 1] !== undefined) options.command = argv[(index += 1)]
        else if (argv[index] === '--model' && argv[index + 1] !== undefined) options.model = argv[(index += 1)]
        else if (argv[index] === '--cwd' && argv[index + 1] !== undefined) options.cwd = argv[(index += 1)]
    }
    return options
}

/** Minimal adapter from Node child_process to the seam subprocess handle. */
function nodeSpawn(spec) {
    const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let exited = false
    const done = new Promise(resolve => {
        child.on('close', (code, signal) => {
            exited = true
            resolve({ code, signal })
        })
    })
    return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        done,
        async waitForExit(signal) {
            if (exited) return true
            return await new Promise(resolve => {
                child.once('close', () => resolve(true))
                if (signal !== undefined) signal.addEventListener('abort', () => resolve(false), { once: true })
            })
        },
        terminate() {
            if (!exited) child.kill('SIGTERM')
        },
    }
}

const options = parseArguments(process.argv.slice(2))
const resolution = resolveAgyCommand({ command: options.command })
if (!resolution.ok) {
    console.error(resolution.error)
    process.exit(2)
}
const version = spawnSync(resolution.command, ['--version'], { encoding: 'utf8', timeout: 15_000 })
const versionText = (version.stdout ?? '').trim() || (version.stderr ?? '').trim() || 'unknown'
mkdirSync(options.cwd, { recursive: true })

const config = resolveConfig({ command: resolution.command, model: options.model === '' ? undefined : options.model })
const prompt = 'Reply with exactly this single word and nothing else: PONG'
const startedAt = Date.now()
const controller = new AbortController()
const run = startAntigravityRun(
    { cwd: options.cwd, prompt: [{ type: 'text', text: prompt }], signal: controller.signal },
    {
        command: resolution.command,
        args: buildAntigravityArgs(config, prompt),
        cwd: options.cwd,
        // The real host layers explicit env over the seam's credential-scrubbed
        // parent environment; the smoke script stands in for that base env.
        env: process.env,
        graceMs: config.disposeGraceMs,
        timeoutMs: config.timeoutMs,
        spawn: nodeSpawn,
        onError: error => console.error(`[provider] ${error.message}`),
    },
)
let result
try {
    result = await run.result
} finally {
    await run.dispose()
}
const answer = result.output.map(block => (block.type === 'text' ? block.text : '')).join('').trim()
const passed = result.stopReason === 'completed' && /PONG/i.test(answer)
const report = {
    ok: passed,
    command: resolution.command,
    version: versionText,
    model: config.model,
    stopReason: result.stopReason,
    answer,
    durationMs: Date.now() - startedAt,
    ...(passed ? {} : { diagnostic: result.diagnostic ?? '(none)' }),
}
if (options.json) console.log(JSON.stringify(report, null, 2))
else {
    for (const [key, value] of Object.entries(report)) console.log(`${key.padEnd(11)}: ${value}`)
}
process.exit(passed ? 0 : 1)
