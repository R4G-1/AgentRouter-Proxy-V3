
import test from "node:test";
import assert from "node:assert/strict";

import {
    SessionManager
} from "../src/session-manager.js";

test("creates a new session", () => {
    const manager = new SessionManager();
    const session = manager.getSession("session-1");

    assert.equal(session.previousResponseId, null);
    assert.equal(session.invalidated, false);
});

test("stores a previous response ID", () => {
    const manager = new SessionManager();

    manager.setPreviousResponseId("session-1", "resp_123");

    const session = manager.getSession("session-1");

    assert.equal(session.previousResponseId, "resp_123");
});

test("invalidates a session after resource mismatch", () => {
    const manager = new SessionManager();

    manager.setPreviousResponseId("session-1", "resp_123");
    manager.invalidateSession("session-1");

    const session = manager.getSession("session-1");

    assert.equal(session.previousResponseId, null);
    assert.equal(session.invalidated, true);
});

test("clears session invalidation", () => {
    const manager = new SessionManager();

    manager.invalidateSession("session-1");
    manager.clearInvalidation("session-1");

    assert.equal(
        manager.getSession("session-1").invalidated,
                 false
    );
});

test("isolates different sessions", () => {
    const manager = new SessionManager();

    manager.setPreviousResponseId("session-1", "resp_123");
    manager.setPreviousResponseId("session-2", "resp_456");

    manager.invalidateSession("session-1");

    assert.equal(
        manager.getSession("session-1").previousResponseId,
                 null
    );

    assert.equal(
        manager.getSession("session-2").previousResponseId,
                 "resp_456"
    );
});

test("deletes a session", () => {
    const manager = new SessionManager();

    manager.getSession("session-1");

    assert.equal(manager.deleteSession("session-1"), true);
    assert.equal(manager.hasSession("session-1"), false);
});

test("counts active sessions", () => {
    const manager = new SessionManager();

    manager.getSession("session-1");
    manager.getSession("session-2");

    assert.equal(manager.getSessionCount(), 2);
});

test("clears all sessions", () => {
    const manager = new SessionManager();

    manager.getSession("session-1");
    manager.getSession("session-2");
    manager.clearAll();

    assert.equal(manager.getSessionCount(), 0);
});

test("rejects invalid session IDs", () => {
    const manager = new SessionManager();

    assert.throws(() => manager.getSession(""), TypeError);
    assert.throws(() => manager.getSession(null), TypeError);
});

test("rejects invalid response IDs", () => {
    const manager = new SessionManager();

    assert.throws(
        () => manager.setPreviousResponseId("session-1", ""),
                  TypeError
    );
});

test("does not expose mutable internal session objects", () => {
    const manager = new SessionManager();

    const session = manager.getSession("session-1");
    session.previousResponseId = "resp_fake";
    session.invalidated = true;

    const actual = manager.getSession("session-1");

    assert.equal(actual.previousResponseId, null);
    assert.equal(actual.invalidated, false);
});
