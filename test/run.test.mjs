import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { promptText, startAntigravityRun } from '../lib/run.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'fake-agy.mjs')
const CWD = mkdtempSync(join(tmpdir(), 'dsh-agy-run-'))

/**
 * Minimal adapter that makes Node's child_process look like the seam's
 * subprocess handle: streams, `done`, `waitForExit`, `terminate`.
 */
function nodeSpawn(spec) {
    const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ['pipe', 'pipe', 'pipe'],
    })
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

/** Run the fixture scenario through the real run layer. */
function runScenario(scenario, overrides = {}) {
    const request = { cwd: CWD, prompt: [{ type: 'text', text: 'fake task' }], signal: overrides.signal ?? new AbortController().signal }
    return startAntigravityRun(request, {
        command: process.execPath,
        args: [FIXTURE, scenario],
        cwd: CWD,
        env: {},
        graceMs: 1000,
        timeoutMs: overrides.timeoutMs ?? 20_000,
        spawn: nodeSpawn,
        ...overrides.spec,
    })
}

/** Collect one result and always dispose the run. */
async function settle(run) {
    try {
        return await run.result
    } finally {
        await run.dispose()
    }
}

test('a successful run returns the final answer as one text block', async () => {
    const run = runScenario('success')
    assert.equal(typeof run.id, 'string')
    const result = await settle(run)
    assert.deepEqual(result, { output: [{ type: 'text', text: 'PONG' }], stopReason: 'completed' })
})

test('the terminal response wins over streamed deltas', async () => {
    const result = await settle(runScenario('response-only'))
    assert.deepEqual(result, { output: [{ type: 'text', text: 'done from response' }], stopReason: 'completed' })
})

test('an empty successful answer is an error result, not a silent success', async () => {
    const result = await settle(runScenario('empty-success'))
    assert.equal(result.stopReason, 'error')
    assert.match(result.diagnostic, /Subagent failure \(provider: Antigravity; stage: run; category: invalid-result/)
})

test('a failed status keeps partial text and reports the category', async () => {
    const result = await settle(runScenario('failure'))
    assert.equal(result.stopReason, 'error')
    assert.match(result.diagnostic, /provider: Antigravity/)
    assert.match(result.diagnostic, /category: product-error/)
})

test('terminal stop reasons map onto the harness vocabulary', async () => {
    assert.equal((await settle(runScenario('refusal'))).stopReason, 'refusal')
    assert.equal((await settle(runScenario('max-tokens'))).stopReason, 'max-tokens')
    assert.equal((await settle(runScenario('cancelled'))).stopReason, 'aborted')
})

test('denied headless permissions are reported with the right hint', async () => {
    const result = await settle(runScenario('denied'))
    assert.equal(result.stopReason, 'error')
    assert.match(result.diagnostic, /category: permission/)
    assert.match(result.diagnostic, /skipPermissions/)
})

test('an exited process without a terminal frame is a process-exit failure', async () => {
    const result = await settle(runScenario('no-result'))
    assert.equal(result.stopReason, 'error')
    assert.match(result.diagnostic, /category: process-exit|category: process/)
})

test('garbage stdout does not crash the runner', async () => {
    const result = await settle(runScenario('garbage'))
    assert.equal(result.stopReason, 'error')
})

test('the configured timeout settles the run and terminates the child', async () => {
    const started = Date.now()
    const result = await settle(runScenario('sleep', { timeoutMs: 400 }))
    assert.equal(result.stopReason, 'error')
    assert.match(result.diagnostic, /category: timeout/)
    assert.equal(Date.now() - started < 15_000, true)
})

test('cancellation through the request signal resolves as aborted', async () => {
    const controller = new AbortController()
    const run = runScenario('sleep', { signal: controller.signal })
    setTimeout(() => controller.abort(), 200)
    const result = await settle(run)
    assert.equal(result.stopReason, 'aborted')
    assert.equal(result.output.length, 0)
})

test('a run that already finished still reports its captured answer after dispose', async () => {
    const run = runScenario('success')
    const result = await run.result
    await run.dispose()
    await run.dispose()
    assert.deepEqual(result.output, [{ type: 'text', text: 'PONG' }])
})

test('starting with a relative or missing cwd fails before spawning', async () => {
    const request = { cwd: 'relative/path', prompt: [{ type: 'text', text: 'x' }], signal: new AbortController().signal }
    assert.throws(() => startAntigravityRun(request, {
        command: process.execPath, args: [FIXTURE, 'success'], cwd: 'relative/path', env: {}, graceMs: 1000, timeoutMs: 1000, spawn: nodeSpawn,
    }), /must be an absolute path/)
    const missing = { cwd: join(CWD, 'does-not-exist'), prompt: [{ type: 'text', text: 'x' }], signal: new AbortController().signal }
    assert.throws(() => startAntigravityRun(missing, {
        command: process.execPath, args: [FIXTURE, 'success'], cwd: missing.cwd, env: {}, graceMs: 1000, timeoutMs: 1000, spawn: nodeSpawn,
    }), /not an accessible directory/)
})

test('an empty prompt is rejected before spawning', () => {
    const request = { cwd: CWD, prompt: [{ type: 'image', data: 'x' }], signal: new AbortController().signal }
    assert.throws(() => startAntigravityRun(request, {
        command: process.execPath, args: [FIXTURE, 'success'], cwd: CWD, env: {}, graceMs: 1000, timeoutMs: 1000, spawn: nodeSpawn,
    }), /no text content/)
})

test('promptText joins text blocks and drops non-text ones', () => {
    assert.equal(promptText([{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }]), 'one\n\ntwo')
    assert.equal(promptText([]), '')
    assert.equal(promptText(undefined), '')
})
