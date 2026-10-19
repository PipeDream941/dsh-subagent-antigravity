import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_DISPOSE_GRACE_MS,
    DEFAULT_MODEL,
    DEFAULT_PROVIDER_NAME,
    DEFAULT_TIMEOUT_MS,
    Config,
    buildAntigravityArgs,
    resolveConfig,
} from '../lib/config.js'

test('the schema resolves an empty config to the documented defaults', () => {
    const resolved = Config({})
    assert.equal(resolved.providerName, DEFAULT_PROVIDER_NAME)
    assert.equal(resolved.command, '')
    assert.equal(resolved.model, DEFAULT_MODEL)
    assert.equal(resolved.effort, '')
    assert.equal(resolved.mode, '')
    assert.equal(resolved.skipPermissions, true)
    assert.equal(resolved.sandbox, false)
    assert.equal(resolved.timeoutMs, DEFAULT_TIMEOUT_MS)
    assert.equal(resolved.disposeGraceMs, DEFAULT_DISPOSE_GRACE_MS)
    assert.deepEqual(resolved.env, {})
    assert.deepEqual(resolved.extraArgs, [])
})

test('resolveConfig is total for missing or wrong-typed fields', () => {
    for (const raw of [undefined, null, 42, 'x']) {
        const resolved = resolveConfig(raw)
        assert.equal(resolved.providerName, DEFAULT_PROVIDER_NAME)
        assert.equal(resolved.model, DEFAULT_MODEL)
        assert.equal(resolved.skipPermissions, true)
    }
    assert.deepEqual(resolveConfig({ env: [] }).env, {})
    assert.deepEqual(resolveConfig({ env: { A: '1', B: 2, C: null } }).env, { A: '1' })
    assert.deepEqual(resolveConfig({ extraArgs: ['--x', 1] }).extraArgs, ['--x', '1'])
    assert.equal(resolveConfig({ providerName: ' custom ' }).providerName, 'custom')
})

test('a wrong-typed model or command falls back to its default', () => {
    assert.equal(resolveConfig({ model: '' }).model, DEFAULT_MODEL)
    assert.equal(resolveConfig({ model: '   ' }).model, DEFAULT_MODEL)
    assert.equal(resolveConfig({ command: 7 }).command, '')
    assert.equal(resolveConfig({ command: 7 }).model, DEFAULT_MODEL)
})

test('effort and mode only accept the CLI vocabulary', () => {
    assert.equal(resolveConfig({ effort: 'high' }).effort, 'high')
    assert.equal(resolveConfig({ effort: 'max' }).effort, 'max')
    assert.equal(resolveConfig({ effort: 'extreme' }).effort, '')
    assert.equal(resolveConfig({ mode: 'plan' }).mode, 'plan')
    assert.equal(resolveConfig({ mode: 'accept-edits' }).mode, 'accept-edits')
    assert.equal(resolveConfig({ mode: 'yolo' }).mode, '')
})

test('booleans and timing bounds are normalized', () => {
    assert.equal(resolveConfig({ skipPermissions: false }).skipPermissions, false)
    assert.equal(resolveConfig({ skipPermissions: true }).skipPermissions, true)
    assert.equal(resolveConfig({ sandbox: 1 }).sandbox, false)
    assert.equal(resolveConfig({ sandbox: true }).sandbox, true)
    assert.equal(resolveConfig({ timeoutMs: 5000 }).timeoutMs, 5000)
    assert.equal(resolveConfig({ timeoutMs: 0 }).timeoutMs, DEFAULT_TIMEOUT_MS)
    assert.equal(resolveConfig({ timeoutMs: -5 }).timeoutMs, DEFAULT_TIMEOUT_MS)
    assert.equal(resolveConfig({ disposeGraceMs: Number.NaN }).disposeGraceMs, DEFAULT_DISPOSE_GRACE_MS)
})

test('the argument vector speaks print-mode stream-json', () => {
    const args = buildAntigravityArgs(resolveConfig({}), 'Do the task')
    assert.deepEqual(args, [
        '--print', 'Do the task',
        '--output-format', 'stream-json',
        '--model', DEFAULT_MODEL,
        '--dangerously-skip-permissions',
    ])
})

test('optional flags are only present when configured', () => {
    const args = buildAntigravityArgs(resolveConfig({ effort: 'high', mode: 'plan', sandbox: true, skipPermissions: false, extraArgs: ['--add-dir', '/extra'] }), 'prompt')
    assert.deepEqual(args, [
        '--print', 'prompt',
        '--output-format', 'stream-json',
        '--model', DEFAULT_MODEL,
        '--effort', 'high',
        '--mode', 'plan',
        '--sandbox',
        '--add-dir', '/extra',
    ])
})

test('the prompt is one argv element and is not duplicated', () => {
    const prompt = 'multi\nline "quoted" $HOME prompt'
    const args = buildAntigravityArgs(resolveConfig({}), prompt)
    assert.equal(args.filter(value => value === prompt).length, 1)
    assert.equal(args[args.indexOf('--print') + 1], prompt)
})
