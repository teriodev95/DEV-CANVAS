import fs from 'fs'
import os from 'os'
import path from 'path'

const USER_HOME = os.homedir()

async function run(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  } catch (err) {
    return { stdout: '', stderr: String(err), exitCode: 1 }
  }
}

function findNearestExistingDirectory(candidate: string): string {
  let current = path.resolve(candidate)

  while (true) {
    try {
      const stats = fs.statSync(current)
      if (stats.isDirectory()) return current
      current = path.dirname(current)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return USER_HOME
      current = parent
    }
  }
}

export function getDefaultWorkingDirectory(): string {
  return USER_HOME
}

export function resolveWorkingDirectory(candidate?: string | null): string {
  const trimmed = candidate?.trim()
  if (!trimmed) return USER_HOME
  return findNearestExistingDirectory(trimmed)
}

export async function readLocalProcessWorkingDirectory(pid: number): Promise<string | null> {
  if (!Number.isFinite(pid) || pid <= 0) return null

  if (process.platform === 'linux') {
    try {
      return resolveWorkingDirectory(fs.readlinkSync(`/proc/${pid}/cwd`))
    } catch {
      return null
    }
  }

  if (process.platform === 'darwin') {
    const lsofCommand = fs.existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof'
    const { stdout, exitCode } = await run(lsofCommand, ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'])
    if (exitCode !== 0 || !stdout) return null

    const line = stdout
      .split('\n')
      .find((entry) => entry.startsWith('n'))

    if (!line || line.length <= 1) return null
    return resolveWorkingDirectory(line.slice(1))
  }

  return null
}
