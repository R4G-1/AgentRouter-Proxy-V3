
/**
 * AgentRouter Proxy V3
 * Session Manager
 */

export class SessionManager {
    constructor() {
        this.sessions = new Map();
    }

    getSession(sessionId) {
        if (typeof sessionId !== "string" || !sessionId.trim()) {
            throw new TypeError("A valid session ID is required.");
        }

        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                previousResponseId: null,
                invalidated: false,
                updatedAt: Date.now()
            });
        }

        const session = this.sessions.get(sessionId);
        session.updatedAt = Date.now();

        return { ...session };
    }

    setPreviousResponseId(sessionId, responseId) {
        if (typeof responseId !== "string" || !responseId.trim()) {
            throw new TypeError("A valid response ID is required.");
        }

        this.getSession(sessionId);

        this.sessions.set(sessionId, {
            previousResponseId: responseId,
            invalidated: false,
            updatedAt: Date.now()
        });
    }

    invalidateSession(sessionId) {
        const session = this.getSession(sessionId);

        this.sessions.set(sessionId, {
            ...session,
            previousResponseId: null,
            invalidated: true,
            updatedAt: Date.now()
        });
    }

    clearInvalidation(sessionId) {
        const session = this.getSession(sessionId);

        this.sessions.set(sessionId, {
            ...session,
            invalidated: false,
            updatedAt: Date.now()
        });
    }

    deleteSession(sessionId) {
        return this.sessions.delete(sessionId);
    }

    hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }

    getSessionCount() {
        return this.sessions.size;
    }

    clearAll() {
        this.sessions.clear();
    }
}
