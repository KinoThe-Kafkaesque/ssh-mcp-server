import { MAX_SESSION_BUFFER, SESSION_TIMEOUT } from './constants.js';
import type { SSHSession, SSHTunnel } from './types.js';

export { MAX_SESSION_BUFFER };

export const activeSessions: Map<string, SSHSession> = new Map();
export const activeTunnels: Map<string, SSHTunnel> = new Map();

let sessionCleanupStarted = false;

export function startSessionCleanup() {
    if (sessionCleanupStarted) {
        return;
    }

    sessionCleanupStarted = true;
    setInterval(() => {
        const now = Date.now();
        for (const [id, session] of activeSessions) {
            if (now - session.lastActivity.getTime() > SESSION_TIMEOUT) {
                console.error(`Cleaning up stale session: ${id}`);
                try {
                    session.channel.close();
                    session.conn.end();
                } catch (e) {
                    // Ignore cleanup errors.
                }
                activeSessions.delete(id);
            }
        }
    }, 5 * 60 * 1000);
}
