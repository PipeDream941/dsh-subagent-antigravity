/**
 * One-shot Antigravity child lifecycle.
 *
 * Each delegation spawns a fresh `agy --print` process in the parent workspace,
 * reads its `--output-format stream-json` event stream, and settles exactly one
 * `SubagentResult`. Startup failures reject `start()` after provider-owned
 * cleanup; post-publication failures resolve through the result with a fixed,
 * safe diagnostic instead of rejecting the run.
 *
 * This module intentionally imports no DeepSeek Harness package: the subagent
 * seam contracts it implements are plain object shapes, which keeps the module
 * unit-testable outside a host and makes `npm run smoke` exercise the exact same
 * code the host runs. The process-handle contract consumed here is the
 * `ctx.subprocess.spawn` surface: `{ stdout, stderr, stdin, done, waitForExit,
 * terminate }`.
 *
 * @module dsh-subagent-antigravity/run
 */

import { randomUUID } from 'node:crypto'
import { accessSync, constants, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** Upper bound for provider-authored diagnostic text (seam contract). */
const MAX_DIAGNOSTIC_BYTES = 4096
/** Per-line stdout cap; a runaway line is dropped rather than buffered forever. */
const MAX_LINE_BYTES = 1024 * 1024

/** Turn a thrown value into an Error. */
export function errorText(value) {
    if (value instanceof Error) return value.message
    return String(value)
}

/**
 * Assert the child directory can host the process.
 *
 * The seam supplies an absolute directory; a relative path would be re-anchored
 * to the host process, and a missing one would surface as an ambiguous spawn
 * ENOENT, so both are rejected before the process boundary.
 *
 * @param {string} prefix - diagnostic prefix.
 * @param {string} label - which source supplied the value.
 * @param {unknown} cwd - candidate directory.
 * @returns {string} the validated directory.
 */
export function assertUsableCwd(prefix, label, cwd) {
    if (typeof cwd !== 'string' || cwd === '') throw new Error(`${prefix}: ${label} is required`)
    if (!isAbsolute(cwd)) throw new Error(`${prefix}: ${label} must be an absolute path: ${cwd}`)
    let directory = false
    try {
        directory = statSync(cwd).isDirectory()
        if (directory) accessSync(cwd, constants.X_OK)
    } catch {
        directory = false
    }
    if (!directory) throw new Error(`${prefix}: ${label} is not an accessible directory: ${cwd}`)
    return cwd
}

/** Join the textual blocks of a harness prompt into the child's task text. */
export function promptText(prompt) {
    if (!Array.isArray(prompt)) return ''
    return prompt
        .filter(block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n\n')
        .trim()
}

/** Map an Antigravity terminal status to the harness stop-reason vocabulary. */
export function mapTerminalStatus(status) {
    switch (String(status).toUpperCase()) {
        case 'SUCCESS':
            return 'completed'
        case 'CANCELLED':
        case 'CANCELED':
            return 'aborted'
        case 'MAX_TOKENS':
        case 'MAX_TOKENS_EXCEEDED':
            return 'max-tokens'
        case 'REFUSAL':
        case 'REFUSED':
            return 'refusal'
        default:
            return 'error'
    }
}

/** Category for a non-success terminal status, using only closed facts. */
function terminalCategory(status) {
    const normalized = String(status).toUpperCase()
    if (normalized === 'CANCELLED' || normalized === 'CANCELED') return 'aborted'
    if (normalized.includes('TIMEOUT')) return 'timeout'
    if (normalized.includes('QUOTA') || normalized.includes('RATE') || normalized.includes('LIMIT')) return 'quota'
    return 'product-error'
}

/** Build one fixed, safe diagnostic line. */
export function diagnosticText(stage, category, extra = '') {
    const base = `Subagent failure (provider: Antigravity; stage: ${stage}; category: ${category}${extra === '' ? '' : `; ${extra}`})`
    const bytes = Buffer.byteLength(base, 'utf8')
    if (bytes <= MAX_DIAGNOSTIC_BYTES) return base
    return base.slice(0, MAX_DIAGNOSTIC_BYTES)
}

/**
 * Classify the child's stderr into a fixed category without retaining its text.
 *
 * Stderr is an observation channel only: it is never copied into the model-
 * visible diagnostic, but a signed-out or rate-limited CLI is recognized so the
 * operator gets the right hint instead of a generic failure.
 */
function classifyStderr(text) {
    if (/sign[\s-]?in|not signed in|login|authenticat|credential/i.test(text)) return 'auth'
    if (/quota|rate limit|429|resource[_ ]exhausted/i.test(text)) return 'quota'
    if (/permission|denied|approval/i.test(text)) return 'permission'
    return 'unknown'
}

/** Map a stderr category to the next step the operator should take. */
function categoryHint(category) {
    switch (category) {
        case 'auth':
            return 'the Antigravity CLI is not signed in; run "agy" once in a terminal and complete the Google sign-in'
        case 'quota':
            return 'the signed-in Antigravity account has no quota for this model right now'
        case 'permission':
            return 'headless mode cannot prompt for permissions; keep skipPermissions enabled or add permission allow rules'
        default:
            return ''
    }
}

/**
 * Wire one `agy --print` process into a seam `SubagentRun`.
 *
 * @param {{cwd?: string, prompt: unknown, signal: AbortSignal}} request - the seam start request.
 * @param {{
 *   command: string,
 *   args: string[],
 *   cwd: string,
 *   env: Record<string, string>,
 *   graceMs: number,
 *   timeoutMs: number,
 *   spawn: (spec: {
 *     argv: string[], cwd: string,
 *     stdio: {stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'},
 *     graceMs: number, env: Record<string, string>,
 *   }) => {
 *     stdin?: { end?: () => void } | undefined,
 *     stdout: { on: Function, off?: Function } | undefined,
 *     stderr?: { on: Function, off?: Function } | undefined,
 *     done: Promise<unknown>,
 *     waitForExit: (signal?: AbortSignal) => Promise<boolean>,
 *     terminate: () => void,
 *   },
 *   onError?: (error: Error, stopReason: string) => void,
 * }} spec - resolved spawn specification.
 * @returns {{id: string, result: Promise<object>, dispose: () => Promise<void>}} the run handle.
 */
export function startAntigravityRun(request, spec) {
    if (request.signal.aborted) {
        throw new Error('subagent-antigravity: request was aborted before the child started')
    }
    const cwd = assertUsableCwd('subagent-antigravity', 'child cwd', request.cwd ?? spec.cwd)
    const prompt = promptText(request.prompt)
    if (prompt === '') {
        throw new Error('subagent-antigravity: the delegation prompt has no text content')
    }

    let child
    try {
        child = spec.spawn({
            argv: [spec.command, ...spec.args],
            cwd,
            stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
            graceMs: spec.graceMs,
            env: spec.env,
        })
    } catch (error) {
        try {
            spec.onError?.(new Error(errorText(error)), 'error')
        } catch {
            /* the diagnostic sink cannot replace the startup failure */
        }
        throw new Error(diagnosticText('process', 'spawn'))
    }
    if (child.stdout === undefined) {
        throw new Error('subagent-antigravity: the subprocess implementation dropped the piped stdout stream')
    }

    // Handle contract: stdin/stdout/stderr are Node streams, `done` settles at
    // process close, `terminate()` owns the SIGTERM→SIGKILL ladder and
    // `waitForExit()` is the bounded observation of that ladder.
    if (child.stdin?.end !== undefined) {
        try {
            child.stdin.end()
        } catch {
            /* stdin is unused in print mode */
        }
    }

    let buffer = ''
    const assistantText = []
    let terminalEvent
    let resolved = false
    let cancelled = false
    let timedOut = false
    let processExited = false
    let processOutcome
    let stderrText = ''

    let resolveTerminal
    const terminal = new Promise(resolve => {
        resolveTerminal = resolve
    })
    /** Resolve the terminal race exactly once. */
    const settle = value => {
        if (resolved) return
        resolved = true
        resolveTerminal(value)
    }

    /** Consume one stdout chunk, keeping only complete NDJSON lines. */
    const onStdout = chunk => {
        buffer += chunk.toString()
        if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES && !buffer.includes('\n')) {
            buffer = ''
            return
        }
        let index
        while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index).trim()
            buffer = buffer.slice(index + 1)
            if (line === '') continue
            let event
            try {
                event = JSON.parse(line)
            } catch {
                continue
            }
            if (event === null || typeof event !== 'object') continue
            if (event.event === 'result' && event.result !== null && typeof event.result === 'object') {
                terminalEvent = event.result
                settle({ kind: 'terminal' })
            } else if (event.event === 'step_update' && event.step_update !== null && typeof event.step_update === 'object') {
                const update = event.step_update
                if (update.step_type === 'agent_response' && typeof update.text_delta === 'string' && update.text_delta !== '') {
                    assistantText.push(update.text_delta)
                }
            }
        }
    }
    /** Capture stderr for classification only; its text never leaves the host. */
    const onStderr = chunk => {
        if (stderrText.length < 8192) stderrText += chunk.toString()
    }
    child.stdout.on('data', onStdout)
    child.stderr?.on?.('data', onStderr)

    /** Flush a final unterminated stdout line when the child closes its pipe. */
    const flushStdout = () => {
        const line = buffer.trim()
        buffer = ''
        if (line === '') return
        try {
            const event = JSON.parse(line)
            if (event?.event === 'result' && event.result !== null && typeof event.result === 'object') {
                terminalEvent = event.result
                settle({ kind: 'terminal' })
            }
        } catch {
            /* a truncated trailing line is not a terminal frame */
        }
    }

    const done = Promise.resolve(child.done).then(
        outcome => {
            processOutcome = outcome
            return outcome
        },
        error => {
            processOutcome = { error: errorText(error) }
            return processOutcome
        },
    )
    void done.then(() => {
        processExited = true
        flushStdout()
        settle({ kind: 'process-exit' })
    })

    let timeoutTimer
    if (spec.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
            timedOut = true
            cancelChild()
            settle({ kind: 'timeout' })
        }, spec.timeoutMs)
    }
    const onAbort = () => {
        cancelled = true
        cancelChild()
        settle({ kind: 'cancelled' })
    }
    request.signal.addEventListener('abort', onAbort, { once: true })

    /** Stop the child through the seam's termination ladder. */
    function cancelChild() {
        try {
            child.terminate()
        } catch {
            /* termination races with a naturally exited process */
        }
    }

    /** Snapshot the child's assistant text as harness content blocks. */
    const collectOutput = () => {
        const text = assistantText.join('').trim()
        return text === '' ? [] : [{ type: 'text', text }]
    }

    /** Build the terminal result from the settled race. */
    const buildResult = race => {
        if (race.kind === 'cancelled' || cancelled) {
            return { output: collectOutput(), stopReason: 'aborted' }
        }
        if (race.kind === 'timeout' || timedOut) {
            return { output: collectOutput(), diagnostic: diagnosticText('run', 'timeout'), stopReason: 'error' }
        }
        if (race.kind === 'process-exit') {
            // The result frame may have raced the process close; prefer it.
            if (terminalEvent === undefined) {
                const category = processExited ? classifyStderr(stderrText) : 'unknown'
                const hint = categoryHint(category)
                const extra = processOutcome !== undefined && typeof processOutcome === 'object' && Number.isInteger(processOutcome.code)
                    ? `exitCode: ${processOutcome.code}`
                    : ''
                const diagnostic = diagnosticText('process', category === 'unknown' ? 'process-exit' : category, extra)
                return { output: collectOutput(), diagnostic: hint === '' ? diagnostic : `${diagnostic}; ${hint}`, stopReason: 'error' }
            }
        }
        const terminalResult = terminalEvent ?? {}
        const status = mapTerminalStatus(terminalResult.status)
        const response = typeof terminalResult.response === 'string' ? terminalResult.response.trim() : ''
        const output = response === '' ? collectOutput() : [{ type: 'text', text: response }]
        const denied = Array.isArray(terminalResult.denied_actions) ? terminalResult.denied_actions.length : 0
        // A run whose tools were auto-denied is an error even when the terminal
        // status says SUCCESS: headless mode cannot prompt, so the child may
        // have answered from partial evidence without doing the requested work.
        if (denied > 0 && status !== 'aborted') {
            const hint = categoryHint('permission')
            const diagnostic = diagnosticText('run', 'permission', `deniedActions: ${denied}`)
            return { output, diagnostic: hint === '' ? diagnostic : `${diagnostic}; ${hint}`, stopReason: 'error' }
        }
        if (status === 'completed') {
            if (output.length === 0) {
                return { output, diagnostic: diagnosticText('run', 'invalid-result'), stopReason: 'error' }
            }
            return { output, stopReason: 'completed' }
        }
        if (status === 'aborted') {
            return { output, stopReason: 'aborted' }
        }
        const category = terminalCategory(terminalResult.status)
        const hint = categoryHint(category)
        const diagnostic = diagnosticText('run', category)
        return { output, diagnostic: hint === '' ? diagnostic : `${diagnostic}; ${hint}`, stopReason: status }
    }

    const result = terminal.then(
        race => buildResult(race),
        () => {
            try {
                spec.onError?.(new Error('terminal race failed'), 'error')
            } catch {
                /* contained */
            }
            return { output: collectOutput(), diagnostic: diagnosticText('run', 'unknown'), stopReason: 'error' }
        },
    )

    let disposal
    /** Idempotent teardown: cancel, wait for the managed range, release streams. */
    const dispose = () => {
        if (disposal !== undefined) return disposal
        disposal = (async () => {
            request.signal.removeEventListener('abort', onAbort)
            if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
            try {
                child.stdout?.off?.('data', onStdout)
                child.stderr?.off?.('data', onStderr)
            } catch {
                /* streams may already be destroyed */
            }
            try {
                child.terminate()
            } catch {
                /* already exited */
            }
            try {
                await child.waitForExit(AbortSignal.timeout(Math.ceil(spec.graceMs + 2000)))
            } catch {
                /* termination ladder failures do not replace a captured result */
            }
            await done
        })()
        return disposal
    }

    return { id: randomUUID(), result, dispose }
}
