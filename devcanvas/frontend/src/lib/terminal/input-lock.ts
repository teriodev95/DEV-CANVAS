/**
 * Singleton input lock per terminal session.
 *
 * Guarantees that at most ONE component can send `terminal:input`
 * for a given sessionId at any time.  When a second TerminalPane
 * mounts for the same session (e.g. fullscreen), it claims the lock
 * and the previous holder silently stops sending.
 *
 * Usage inside TerminalPane:
 *   const handle = acquireInputLock(sessionId);
 *   // before every send:
 *   if (!handle.isOwner()) return;
 *   // on cleanup:
 *   handle.release();
 */

const owners = new Map<string, symbol>();

export interface InputLockHandle {
	/** Returns true only if this handle still owns the lock. */
	isOwner: () => boolean;
	/** Releases the lock (only if still owner). */
	release: () => void;
}

export function acquireInputLock(sessionId: string): InputLockHandle {
	const token = Symbol(sessionId);
	owners.set(sessionId, token);

	return {
		isOwner: () => owners.get(sessionId) === token,
		release: () => {
			if (owners.get(sessionId) === token) {
				owners.delete(sessionId);
			}
		},
	};
}
