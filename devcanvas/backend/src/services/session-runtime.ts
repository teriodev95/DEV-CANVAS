import type { SessionRow } from '../db'
import { killPty } from './pty'
import { resolveSshTarget, terminateRemoteDurableSession } from './ssh'
import * as tmuxService from './tmux'

export async function terminateSessionRuntime(session: SessionRow): Promise<void> {
  if (session.type === 'tmux') {
    await tmuxService.killSession(session.name)
    return
  }

  if (session.type === 'ssh') {
    if (session.ssh_durable && session.ssh_remote_session && (session.ssh_lookup || session.ssh_host)) {
      await terminateRemoteDurableSession(resolveSshTarget({
        lookup: session.ssh_lookup ?? undefined,
        host: session.ssh_host ?? undefined,
        user: session.ssh_user ?? undefined,
        port: session.ssh_port ?? undefined,
        label: session.name,
        durable: Boolean(session.ssh_durable),
        remoteSessionName: session.ssh_remote_session ?? undefined,
        identityFile: session.ssh_identity_file ?? undefined,
      }))
    }
  }

  killPty(session.id)
}
