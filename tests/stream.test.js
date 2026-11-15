
import test from "node:test";
import assert from "node:assert/strict";

import {
    parseSSEEvent,
    inspectSSEEvent,
    StreamInspector
} from "../src/stream-inspector.js";

test("parses a basic SSE event", () => {
    const result = parseSSEEvent(
        'event: response.created\ndata: {"type":"response.created"}'
    );

    assert.equal(result.event, "response.created");
    assert.equal(result.data.type, "response.created");
});

test("parses multiple data lines", () => {
    const result = parseSSEEvent(
        "data: first\ndata: second"
    );

    assert.equal(result.rawData, "first\nsecond");
});

test("ignores SSE comments", () => {
    const result = parseSSEEvent(
        ": keepalive\ndata: hello"
    );

    assert.equal(result.rawData, "hello");
});

test("recognizes the DONE marker", () => {
    const result = inspectSSEEvent({
        event: "message",
        data: "[DONE]"
    });

    assert.equal(result.type, "done");
    assert.equal(result.responseStarted, true);
});

test("detects response.failed events", () => {
    const result = inspectSSEEvent({
        event: "message",
        data: {
            type: "response.failed",
            error: { message: "Generation failed" }
        }
    });

    assert.equal(result.type, "error");
    assert.equal(result.error.message, "Generation failed");
});

test("detects explicit error events", () => {
    const result = inspectSSEEvent({
        event: "error",
        data: { message: "Upstream failure" }
    });

    assert.equal(result.type, "error");
    assert.equal(result.error.message, "Upstream failure");
});

test("detects response.incomplete events", () => {
    const result = inspectSSEEvent({
        event: "message",
        data: {
            type: "response.incomplete",
            message: "Output incomplete"
        }
    });

    assert.equal(result.type, "error");
});

test("inspects streamed chunks", () => {
    const inspector = new StreamInspector();

    const events = inspector.push(
        'data: {"type":"response.created"}\n\n'
    );

    assert.equal(events.length, 1);
    assert.equal(inspector.hasStarted(), true);
});

test("handles events split across chunks", () => {
    const inspector = new StreamInspector();

    const first = inspector.push("data: {\"type\":");
    const second = inspector.push("\"response.created\"}\n\n");

    assert.equal(first.length, 0);
    assert.equal(second.length, 1);
    assert.equal(inspector.hasStarted(), true);
});

test("stores stream errors", () => {
    const inspector = new StreamInspector();

    inspector.push(
        'data: {"type":"response.failed","error":{"message":"Failed"}}\n\n'
    );

    assert.equal(inspector.hasError(), true);
    assert.equal(inspector.getError().message, "Failed");
});

test("recognizes stream completion", () => {
    const inspector = new StreamInspector();

    inspector.push("data: [DONE]\n\n");

    assert.equal(inspector.isFinished(), true);
});

test("ignores chunks after completion", () => {
    const inspector = new StreamInspector();

    inspector.push("data: [DONE]\n\n");

    const events = inspector.push("data: hello\n\n");

    assert.equal(events.length, 0);
});

test("finishes a final event without a delimiter", () => {
    const inspector = new StreamInspector();

    inspector.push('data: {"type":"response.created"}');

    const events = inspector.finish();

    assert.equal(events.length, 1);
    assert.equal(inspector.hasStarted(), true);
});

test("handles UTF-8 characters split across chunks", () => {
    const inspector = new StreamInspector();

    const bytes = Buffer.from(
        "data: café مرحبا\n\n",
        "utf8"
    );

    // Split in the middle of the UTF-8 encoding of é.
    const splitAt =
    bytes.indexOf(Buffer.from("é")) + 1;

    const first = inspector.push(
        bytes.subarray(0, splitAt)
    );

    const second = inspector.push(
        bytes.subarray(splitAt)
    );

    assert.equal(first.length, 0);
    assert.equal(second.length, 1);

    assert.equal(
        second[0].parsed.rawData,
        "café مرحبا"
    );
});

test("flushes incomplete UTF-8 bytes when finishing", () => {
    const inspector = new StreamInspector();

    const bytes = Buffer.from(
        "data: test é",
        "utf8"
    );

    // Remove the final byte of the UTF-8 character.
    inspector.push(
        bytes.subarray(0, bytes.length - 1)
    );

    const events = inspector.finish();

    assert.equal(events.length, 1);

    assert.equal(
        events[0].parsed.rawData,
        "test �"
    );
});
