import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    INSTALL_HINT,
    executableNames,
    isExecutableFile,
    resolveAgyCommand,
    searchDirectories,
} from '../lib/resolve.js'

/** Create a temp root used as a fake home or PATH directory. */
function temporaryRoot(label) {
    return mkdtempSync(join(tmpdir(), `dsh-agy-resolve-${label}-`))
}

/** Create an executable stub named `name` inside `dir`. */
function executableStub(dir, name) {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    writeFileSync(path, '#!/bin/sh\nexit 0\n')
    chmodSync(path, 0o755)
    return path
}

test('platform-specific executable names', () => {
    assert.deepEqual(executableNames('darwin'), ['agy'])
    assert.deepEqual(executableNames('linux'), ['agy'])
    assert.deepEqual(executableNames('win32'), ['agy.exe', 'agy.cmd', 'agy.bat', 'agy'])
})

test('searchDirectories is PATH first, then ~/.local/bin, deduplicated', () => {
    const home = '/Users/example'
    const dirs = searchDirectories({ env: { PATH: '/usr/bin:/bin:/usr/bin' }, home })
    assert.equal(dirs[0], '/usr/bin')
    assert.equal(dirs.includes(join(home, '.local', 'bin')), true)
    assert.equal(new Set(dirs).size, dirs.length)
})

test('an absolute configured command is used verbatim', () => {
    const dir = temporaryRoot('absolute')
    const stub = executableStub(dir, 'agy')
    const resolved = resolveAgyCommand({ command: stub, env: {}, home: dir, platform: 'darwin' })
    assert.deepEqual(resolved, { ok: true, command: stub, source: 'configured' })
})

test('a missing configured command fails with an actionable error', () => {
    const dir = temporaryRoot('missing')
    const resolved = resolveAgyCommand({ command: join(dir, 'nope', 'agy'), env: {}, home: dir, platform: 'darwin' })
    assert.equal(resolved.ok, false)
    assert.match(resolved.error, /configured command is not an executable file/)
})

test('~ is expanded in a configured command', () => {
    const home = temporaryRoot('tilde')
    const stub = executableStub(join(home, '.local', 'bin'), 'agy')
    const resolved = resolveAgyCommand({ command: '~/.local/bin/agy', env: {}, home, platform: 'darwin' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, stub)
})

test('PATH lookup finds the CLI', () => {
    const dir = temporaryRoot('path')
    const bin = join(dir, 'bin')
    const stub = executableStub(bin, 'agy')
    const resolved = resolveAgyCommand({ env: { PATH: `${bin}:/usr/bin` }, home: join(dir, 'home'), platform: 'darwin' })
    assert.deepEqual(resolved, { ok: true, command: stub, source: 'path' })
})

test('the fallback search finds ~/.local/bin when the host PATH does not include it', () => {
    const home = temporaryRoot('fallback')
    const stub = executableStub(join(home, '.local', 'bin'), 'agy')
    const resolved = resolveAgyCommand({ env: { PATH: '/usr/bin:/bin' }, home, platform: 'darwin' })
    assert.deepEqual(resolved, { ok: true, command: stub, source: 'search' })
})

test('a bare configured name is resolved through the search space', () => {
    const dir = temporaryRoot('bare')
    const bin = join(dir, 'bin')
    const stub = executableStub(bin, 'agy')
    const resolved = resolveAgyCommand({ command: 'agy', env: { PATH: bin }, home: join(dir, 'home'), platform: 'darwin' })
    assert.deepEqual(resolved, { ok: true, command: stub, source: 'configured' })
})

test('a configured custom basename is looked up verbatim', () => {
    const dir = temporaryRoot('custom-name')
    const bin = join(dir, 'bin')
    const stub = executableStub(bin, 'agy-nightly')
    const resolved = resolveAgyCommand({ command: 'agy-nightly', env: { PATH: bin }, home: join(dir, 'home'), platform: 'darwin' })
    assert.deepEqual(resolved, { ok: true, command: stub, source: 'configured' })
})

test('not finding the CLI produces the official install hint', () => {
    const dir = temporaryRoot('nothing')
    const resolved = resolveAgyCommand({ env: { PATH: '/usr/bin:/bin' }, home: dir, platform: 'darwin' })
    assert.equal(resolved.ok, false)
    assert.match(resolved.error, /Antigravity CLI \(agy\) was not found/)
    assert.equal(INSTALL_HINT, 'curl -fsSL https://antigravity.google/cli/install.sh | bash')
    assert.equal(resolved.error.includes(INSTALL_HINT), true)
})

test('windows candidate names are honoured', () => {
    const dir = temporaryRoot('win')
    const bin = join(dir, 'bin')
    const stub = executableStub(bin, 'agy.exe')
    const resolved = resolveAgyCommand({ env: { PATH: bin }, home: join(dir, 'home'), platform: 'win32' })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.command, stub)
})

test('isExecutableFile rejects directories, missing and non-executable files', () => {
    const dir = temporaryRoot('probe')
    assert.equal(isExecutableFile(dir, { platform: 'darwin' }), false)
    assert.equal(isExecutableFile(join(dir, 'nope'), { platform: 'darwin' }), false)
    const plain = join(dir, 'agy')
    writeFileSync(plain, 'not executable')
    chmodSync(plain, 0o644)
    assert.equal(isExecutableFile(plain, { platform: 'darwin' }), false)
    const stub = executableStub(dir, 'agy')
    assert.equal(isExecutableFile(stub, { platform: 'darwin' }), true)
})
