/**
 * Locate the Antigravity CLI (`agy`) executable.
 *
 * The official installer puts the binary in `~/.local/bin`, but a DSH host
 * started from a desktop launcher does not necessarily inherit the interactive
 * shell's `PATH`. The resolver therefore checks the explicit setting, then
 * `PATH`, then the common per-user and package-manager locations before
 * reporting the install command.
 *
 * @module dsh-subagent-antigravity/resolve
 */

import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'

/** Official install command shown in the error and the README. */
export const INSTALL_HINT = 'curl -fsSL https://antigravity.google/cli/install.sh | bash'

/** Directories an official or package-manager install commonly uses. */
function commonDirectories(home) {
    return [
        join(home, '.local', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        join(home, '.npm-global', 'bin'),
        join(home, 'bin'),
    ]
}

/**
 * File names the CLI may use on this platform.
 * @param {NodeJS.Platform} platform - platform id.
 * @returns {string[]} candidate basenames in preference order.
 */
export function executableNames(platform) {
    return platform === 'win32' ? ['agy.exe', 'agy.cmd', 'agy.bat', 'agy'] : ['agy']
}

/**
 * Every directory the resolver searches, in order, without duplicates.
 * @param {{env?: NodeJS.ProcessEnv, home?: string}} [options] - environment view.
 * @returns {string[]} absolute directories.
 */
export function searchDirectories(options = {}) {
    const env = options.env ?? process.env
    const home = options.home ?? homedir()
    const pathValue = env.PATH ?? env.Path ?? ''
    const dirs = []
    for (const entry of String(pathValue).split(delimiter)) {
        if (entry !== '') dirs.push(entry)
    }
    for (const entry of commonDirectories(home)) dirs.push(entry)
    return [...new Set(dirs)]
}

/** Default executability probe (real filesystem). */
function defaultProbe(path, platform) {
    try {
        if (!statSync(path).isFile()) return false
        if (platform !== 'win32') accessSync(path, constants.X_OK)
        return true
    } catch {
        return false
    }
}

/** Whether a path names an executable file. */
export function isExecutableFile(path, options = {}) {
    const platform = options.platform ?? process.platform
    const probe = options.probe ?? defaultProbe
    try {
        return probe(path, platform) === true
    } catch {
        return false
    }
}

/** Expand a leading `~/` against the given home directory. */
function expandHome(value, home) {
    if (value === '~') return home
    if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2))
    return value
}

/**
 * Resolve the Antigravity CLI executable to spawn.
 *
 * @param {{command?: string, env?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform,
 *   probe?: (path: string, platform: NodeJS.Platform) => boolean}} [options] - `command` is the
 *   configured value (empty means auto-detect).
 * @returns {{ok: true, command: string, source: 'configured' | 'path' | 'search'}
 *   | {ok: false, error: string}} the executable, or an actionable error.
 */
export function resolveAgyCommand(options = {}) {
    const env = options.env ?? process.env
    const home = options.home ?? homedir()
    const platform = options.platform ?? process.platform
    const probe = options.probe
    const configured = typeof options.command === 'string' ? options.command.trim() : ''
    const names = executableNames(platform)

    if (configured !== '') {
        const expanded = expandHome(configured, home)
        if (isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) {
            if (isExecutableFile(expanded, { platform, probe })) return { ok: true, command: expanded, source: 'configured' }
            return {
                ok: false,
                error: `configured command is not an executable file: ${expanded}. Fix the "command" setting or clear it to auto-detect.`,
            }
        }
        // A bare configured name is looked up verbatim, with the platform
        // candidates tried first when it matches one of them.
        const lookupNames = names.includes(configured) ? names : [configured]
        for (const dir of searchDirectories({ env, home })) {
            for (const name of lookupNames) {
                const candidate = join(dir, name)
                if (isExecutableFile(candidate, { platform, probe })) return { ok: true, command: candidate, source: 'configured' }
            }
        }
        return {
            ok: false,
            error: `configured command "${configured}" was not found in PATH or the usual install locations.`,
        }
    }

    for (const dir of searchDirectories({ env, home })) {
        for (const name of names) {
            const candidate = join(dir, name)
            if (isExecutableFile(candidate, { platform, probe })) {
                const onPath = String(env.PATH ?? env.Path ?? '').split(delimiter).includes(dir)
                return { ok: true, command: candidate, source: onPath ? 'path' : 'search' }
            }
        }
    }

    return {
        ok: false,
        error: 'Antigravity CLI (agy) was not found. Install it with "' + INSTALL_HINT
            + '", then verify with "agy --version" and reload the profile; '
            + 'or set the provider\'s "command" option to the agy executable path.',
    }
}
