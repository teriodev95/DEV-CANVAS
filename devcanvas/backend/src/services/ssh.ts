import { existsSync, mkdirSync, readFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { getDb } from '../db'

export type SshTargetSource = 'ssh-config' | 'known-hosts' | 'recent' | 'manual'

export interface SshTarget {
  lookup: string
  label: string
  host?: string
  user?: string
  port?: number
  source: SshTargetSource
}

export interface ResolveSshTargetInput {
  lookup?: string
  host?: string
  user?: string
  port?: number
  label?: string
  durable?: boolean
  remoteSessionName?: string | null
  identityFile?: string | null
}

export interface ResolvedSshTarget {
  lookup: string
  label: string
  host: string
  user: string
  port: number
  identityFile?: string | null
  durable: boolean
  remoteSessionName?: string | null
}

const SSH_CONTROL_DIR = path.join(os.tmpdir(), 'devcanvas-ssh')

function currentUser(): string {
  return process.env.USER || process.env.LOGNAME || 'root'
}

function normalizeWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

function pushTarget(targets: Map<string, SshTarget>, target: SshTarget) {
  const lookup = target.lookup.trim()
  if (!lookup) return
  const key = `${lookup}:${target.port ?? 22}`
  if (targets.has(key)) return
  targets.set(key, { ...target, lookup })
}

function parseConfigTargets(targets: Map<string, SshTarget>) {
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config')
  if (!existsSync(sshConfigPath)) return

  const lines = readFileSync(sshConfigPath, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^Host\s+(.+)$/i)
    if (!match) continue
    const hostList = match[1] ?? ''
    for (const part of hostList.split(/\s+/)) {
      if (!part || part.includes('*') || part.includes('?') || part.startsWith('!')) continue
      pushTarget(targets, {
        lookup: part,
        label: part,
        source: 'ssh-config',
      })
    }
  }
}

function parseKnownHostsTargets(targets: Map<string, SshTarget>) {
  const knownHostsPath = path.join(os.homedir(), '.ssh', 'known_hosts')
  if (!existsSync(knownHostsPath)) return

  const lines = readFileSync(knownHostsPath, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    let hostField = line.split(/\s+/)[0] ?? ''
    if (!hostField || hostField.startsWith('|1|')) continue
    if (hostField.startsWith('@')) {
      const [, nextField = ''] = line.split(/\s+/)
      hostField = nextField
    }

    for (const hostToken of hostField.split(',')) {
      const token = hostToken.trim()
      if (!token || token.includes('*') || token.includes('?') || token.startsWith('!')) continue

      const bracketed = token.match(/^\[([^\]]+)\]:(\d+)$/)
      if (bracketed) {
        const host = bracketed[1]
        const port = bracketed[2]
        if (!host || !port) continue
        pushTarget(targets, {
          lookup: host,
          label: `${host}:${port}`,
          host,
          port: Number(port),
          source: 'known-hosts',
        })
        continue
      }

      pushTarget(targets, {
        lookup: token,
        label: token,
        host: token,
        source: 'known-hosts',
      })
    }
  }
}

function parseRecentTargets(targets: Map<string, SshTarget>) {
  const rows = getDb().query(`
    SELECT DISTINCT
      COALESCE(ssh_lookup, ssh_host) AS lookup,
      ssh_host AS host,
      ssh_user AS user,
      ssh_port AS port,
      name,
      last_activity
    FROM sessions
    WHERE type = 'ssh' AND COALESCE(ssh_lookup, ssh_host) IS NOT NULL
    ORDER BY last_activity DESC
  `).all() as Array<{
    lookup: string | null
    host: string | null
    user: string | null
    port: number | null
    name: string
  }>

  for (const row of rows) {
    if (!row.lookup) continue
    pushTarget(targets, {
      lookup: row.lookup,
      label: row.name || row.lookup,
      host: row.host ?? undefined,
      user: row.user ?? undefined,
      port: row.port ?? undefined,
      source: 'recent',
    })
  }
}

function parseSshConfigOutput(output: string): Record<string, string[]> {
  const values: Record<string, string[]> = {}
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const spaceIdx = line.indexOf(' ')
    if (spaceIdx === -1) continue
    const key = line.slice(0, spaceIdx).toLowerCase()
    const value = normalizeWhitespace(line.slice(spaceIdx + 1))
    if (!values[key]) values[key] = []
    values[key].push(value)
  }
  return values
}

function firstValue(config: Record<string, string[]>, key: string): string | undefined {
  return config[key]?.find((value) => value.length > 0)
}

function displayLabel(lookup: string, user: string, host: string, port: number, preferred?: string): string {
  if (preferred?.trim()) return preferred.trim()
  if (lookup && lookup !== host) return lookup
  return port === 22 ? `${user}@${host}` : `${user}@${host}:${port}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

export function listSshTargets(): SshTarget[] {
  const targets = new Map<string, SshTarget>()
  parseConfigTargets(targets)
  parseKnownHostsTargets(targets)
  parseRecentTargets(targets)
  return Array.from(targets.values()).sort((a, b) => a.label.localeCompare(b.label))
}

export function resolveSshTarget(input: ResolveSshTargetInput): ResolvedSshTarget {
  const lookup = input.lookup?.trim() || input.host?.trim()
  if (!lookup) {
    throw new Error('SSH target lookup is required')
  }

  const args = ['-G']
  if (input.port) args.push('-p', String(input.port))
  if (input.user) args.push('-l', input.user)
  args.push(lookup)

  const proc = Bun.spawnSync(['ssh', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  })

  const stdout = proc.stdout.toString()
  const config = parseSshConfigOutput(stdout)
  const host = input.host?.trim() || firstValue(config, 'hostname') || lookup
  const user = input.user?.trim() || firstValue(config, 'user') || currentUser()
  const port = input.port ?? Number(firstValue(config, 'port') || '22')
  const identityFile = input.identityFile ?? firstValue(config, 'identityfile') ?? null

  return {
    lookup,
    label: displayLabel(lookup, user, host, port, input.label),
    host,
    user,
    port: Number.isFinite(port) ? port : 22,
    identityFile,
    durable: input.durable ?? true,
    remoteSessionName: input.remoteSessionName ?? null,
  }
}

export function makeDurableRemoteSessionName(sessionId: string): string {
  return `devcanvas-${sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
}

export function makeSshTargetString(target: ResolvedSshTarget): string {
  return target.lookup || target.host
}

export function getSshControlPath(sessionId: string): string {
  mkdirSync(SSH_CONTROL_DIR, { recursive: true })
  return path.join(SSH_CONTROL_DIR, `${sessionId}.sock`)
}

export function makeRemoteDurableShellCommand(remoteSessionName: string): string {
  return [
    'sh -lc',
    shellQuote(
      `if command -v tmux >/dev/null 2>&1; then exec tmux new-session -A -D -s ${shellQuote(remoteSessionName)}; else exec "\${SHELL:-/bin/sh}" -l; fi`
    ),
  ].join(' ')
}

export async function terminateRemoteDurableSession(target: ResolvedSshTarget): Promise<void> {
  if (!target.remoteSessionName) return

  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-o', 'ConnectionAttempts=1',
    '-o', 'LogLevel=ERROR',
  ]
  if (target.port) args.push('-p', String(target.port))
  if (target.user) args.push('-l', target.user)
  if (target.identityFile) args.push('-i', target.identityFile)
  args.push(makeSshTargetString(target))
  args.push(`tmux kill-session -t ${shellQuote(target.remoteSessionName)}`)

  const proc = Bun.spawn(['ssh', ...args], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    env: process.env,
  })
  await proc.exited
}
