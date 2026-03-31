import { mkdirSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { resolveWorkingDirectory } from './working-dir'

const INTEGRATION_ROOT = path.join(os.tmpdir(), 'devcanvas-shell-integration')
const BASH_RC_PATH = path.join(INTEGRATION_ROOT, 'bashrc')
const ZSH_DOTDIR = path.join(INTEGRATION_ROOT, 'zdotdir')
const ZSH_RC_PATH = path.join(ZSH_DOTDIR, '.zshrc')
const OSC7_PREFIX = '\x1b]7;'
const OSC7_SUFFIX_BEL = '\x07'
const OSC7_SUFFIX_ST = '\x1b\\'

const URL_ENCODE_SHELL_FN = [
  '_devcanvas_urlencode() {',
  '  local value="$1"',
  '  value="${value//%/%25}"',
  '  value="${value// /%20}"',
  '  value="${value//#/%23}"',
  '  value="${value//\\?/%3F}"',
  '  value="${value//;/%3B}"',
  '  value="${value//+/%2B}"',
  "  value=\"${value//$'\\n'/%0A}\"",
  "  printf '%s' \"$value\"",
  '}',
].join('\n')

const BASH_RC = [
  'if [ -n "$DEVCANVAS_ORIGINAL_BASHRC" ] && [ -r "$DEVCANVAS_ORIGINAL_BASHRC" ]; then',
  '  . "$DEVCANVAS_ORIGINAL_BASHRC"',
  'elif [ -r "$HOME/.bashrc" ]; then',
  '  . "$HOME/.bashrc"',
  'fi',
  '',
  URL_ENCODE_SHELL_FN,
  '',
  '_devcanvas_emit_osc7() {',
  '  local encoded_pwd',
  '  encoded_pwd=$(_devcanvas_urlencode "$PWD")',
  "  printf '\\033]7;file://localhost%s\\007' \"$encoded_pwd\"",
  '}',
  '',
  'case ";${PROMPT_COMMAND:-};" in',
  '  *";_devcanvas_emit_osc7;"*) ;;',
  '  *)',
  '    if [ -n "${PROMPT_COMMAND:-}" ]; then',
  '      PROMPT_COMMAND="_devcanvas_emit_osc7;${PROMPT_COMMAND}"',
  '    else',
  '      PROMPT_COMMAND="_devcanvas_emit_osc7"',
  '    fi',
  '    ;;',
  'esac',
  '',
  '_devcanvas_emit_osc7',
].join('\n')

const ZSH_RC = [
  'if [ -n "$DEVCANVAS_ORIGINAL_ZDOTDIR" ] && [ -r "$DEVCANVAS_ORIGINAL_ZDOTDIR/.zshrc" ]; then',
  '  source "$DEVCANVAS_ORIGINAL_ZDOTDIR/.zshrc"',
  'elif [ -r "$HOME/.zshrc" ]; then',
  '  source "$HOME/.zshrc"',
  'fi',
  '',
  URL_ENCODE_SHELL_FN,
  '',
  '_devcanvas_emit_osc7() {',
  '  local encoded_pwd',
  '  encoded_pwd=$(_devcanvas_urlencode "$PWD")',
  "  printf '\\033]7;file://localhost%s\\007' \"$encoded_pwd\"",
  '}',
  '',
  'autoload -U add-zsh-hook >/dev/null 2>&1',
  'if (( $+functions[add-zsh-hook] )); then',
  '  add-zsh-hook precmd _devcanvas_emit_osc7',
  '  add-zsh-hook chpwd _devcanvas_emit_osc7',
  'fi',
  '',
  '_devcanvas_emit_osc7',
].join('\n')

let shellIntegrationReady = false

export interface ShellLaunchConfig {
  args: string[]
  env: Record<string, string>
}

function ensureShellIntegrationFiles() {
  if (shellIntegrationReady) return

  mkdirSync(INTEGRATION_ROOT, { recursive: true })
  mkdirSync(ZSH_DOTDIR, { recursive: true })
  writeFileSync(BASH_RC_PATH, BASH_RC, 'utf8')
  writeFileSync(ZSH_RC_PATH, ZSH_RC, 'utf8')
  shellIntegrationReady = true
}

function resolveOriginalZdotdir(): string {
  const fromEnv = process.env.ZDOTDIR?.trim()
  if (fromEnv) return fromEnv
  return os.homedir()
}

function resolveOriginalBashRc(): string {
  const fromEnv = process.env.DEVCANVAS_ORIGINAL_BASHRC?.trim()
  if (fromEnv) return fromEnv
  return path.join(os.homedir(), '.bashrc')
}

export function getShellLaunchConfig(shellPath: string): ShellLaunchConfig {
  ensureShellIntegrationFiles()

  const shellName = path.basename(shellPath)
  if (shellName === 'zsh') {
    return {
      args: [shellPath, '-i'],
      env: {
        ZDOTDIR: ZSH_DOTDIR,
        DEVCANVAS_ORIGINAL_ZDOTDIR: resolveOriginalZdotdir(),
      },
    }
  }

  if (shellName === 'bash') {
    return {
      args: [shellPath, '--rcfile', BASH_RC_PATH, '-i'],
      env: {
        DEVCANVAS_ORIGINAL_BASHRC: resolveOriginalBashRc(),
      },
    }
  }

  return {
    args: [shellPath, '-i'],
    env: {},
  }
}

function splitTrailingOscPrefix(input: string): { visibleText: string; pendingText: string } {
  for (let suffixLength = Math.min(OSC7_PREFIX.length - 1, input.length); suffixLength > 0; suffixLength -= 1) {
    const suffix = input.slice(-suffixLength)
    if (OSC7_PREFIX.startsWith(suffix)) {
      return {
        visibleText: input.slice(0, -suffixLength),
        pendingText: suffix,
      }
    }
  }

  return { visibleText: input, pendingText: '' }
}

export function parseOsc7WorkingDirectory(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'file:') return null

    let nextPath = decodeURIComponent(url.pathname)
    if (nextPath.startsWith('//')) nextPath = nextPath.slice(1)
    if (/^\/[A-Za-z]:[\\/]/.test(nextPath)) {
      nextPath = nextPath.slice(1).replace(/\\/g, '/')
    }

    return resolveWorkingDirectory(nextPath)
  } catch {
    return null
  }
}

export function consumeOsc7Output(
  input: string,
  onWorkingDirChange: (workingDir: string) => void
): { visibleText: string; pendingText: string } {
  let visibleText = ''
  let cursor = 0

  while (cursor < input.length) {
    const start = input.indexOf(OSC7_PREFIX, cursor)
    if (start === -1) {
      const tail = splitTrailingOscPrefix(input.slice(cursor))
      visibleText += tail.visibleText
      return { visibleText, pendingText: tail.pendingText }
    }

    visibleText += input.slice(cursor, start)
    const payloadStart = start + OSC7_PREFIX.length
    const belIndex = input.indexOf(OSC7_SUFFIX_BEL, payloadStart)
    const stIndex = input.indexOf(OSC7_SUFFIX_ST, payloadStart)

    let terminatorIndex = -1
    let terminatorLength = 0

    if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
      terminatorIndex = belIndex
      terminatorLength = OSC7_SUFFIX_BEL.length
    } else if (stIndex !== -1) {
      terminatorIndex = stIndex
      terminatorLength = OSC7_SUFFIX_ST.length
    }

    if (terminatorIndex === -1) {
      return { visibleText, pendingText: input.slice(start) }
    }

    const workingDir = parseOsc7WorkingDirectory(input.slice(payloadStart, terminatorIndex).trim())
    if (workingDir) onWorkingDirChange(workingDir)

    cursor = terminatorIndex + terminatorLength
  }

  return { visibleText, pendingText: '' }
}
