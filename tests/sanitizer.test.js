
import test from "node:test";
import assert from "node:assert/strict";

import {
    sanitizeResponsesInput,
    sanitizeResponsesPayload
} from "../src/responses-sanitizer.js";

test("removes incompatible reasoning items", () => {
    const input = [
        { type: "reasoning", id: "rs_123", encrypted_content: "secret" },
        { type: "message", role: "user", content: "Hello" }
    ];

    const result = sanitizeResponsesInput(input);

    assert.equal(result.length, 1);
    assert.equal(result[0].role, "user");
});

test("removes failed assistant messages", () => {
    const input = [
        {
            type: "message",
            role: "assistant",
            status: "error",
            content: "Failed"
        },
        {
            type: "message",
            role: "user",
            content: "Continue"
        }
    ];

    const result = sanitizeResponsesInput(input);

    assert.equal(result.length, 1);
    assert.equal(result[0].role, "user");
});

test("removes backend-specific item IDs", () => {
    const input = [
        {
            type: "function_call",
            id: "fc_backend123",
            call_id: "call_123",
            name: "test_tool",
            arguments: "{}"
        }
    ];

    const result = sanitizeResponsesInput(input);

    assert.equal("id" in result[0], false);
    assert.equal(result[0].call_id, "call_123");
});

test("preserves valid tool call relationships", () => {
    const input = [
        {
            type: "function_call",
            id: "fc_123",
            call_id: "call_123",
            name: "test_tool",
            arguments: "{}"
        },
        {
            type: "function_call_output",
            call_id: "call_123",
            output: "success"
        }
    ];

    const result = sanitizeResponsesInput(input);

    assert.equal(result.length, 2);
    assert.equal(result[0].call_id, result[1].call_id);
});

test("removes incompatible nested content blocks", () => {
    const input = [
        {
            type: "message",
            role: "assistant",
            content: [
                { type: "reasoning", id: "rs_nested" },
                { type: "output_text", text: "Hello", id: "msg_123" }
            ]
        }
    ];

    const result = sanitizeResponsesInput(input);

    assert.equal(result[0].content.length, 1);
    assert.equal(result[0].content[0].text, "Hello");
    assert.equal("id" in result[0].content[0], false);
});

test("does not modify the original input", () => {
    const input = [
        {
            type: "message",
            role: "user",
            id: "msg_123",
            content: "Hello"
        }
    ];

    const original = structuredClone(input);

    sanitizeResponsesInput(input);

    assert.deepEqual(input, original);
});

test("removes previous_response_id from payload", () => {
    const payload = {
        model: "gpt-6.1-sol",
        previous_response_id: "resp_old",
        input: [
            { type: "message", role: "user", content: "Hello" }
        ]
    };

    const result = sanitizeResponsesPayload(payload);

    assert.equal("previous_response_id" in result, false);
    assert.equal(result.model, payload.model);
    assert.equal(payload.previous_response_id, "resp_old");
});

test("preserves unrelated payload fields", () => {
    const payload = {
        model: "gpt-6.1-sol",
        stream: true,
        temperature: 0.5,
        metadata: { session: "test" },
        input: []
    };

    const result = sanitizeResponsesPayload(payload);

    assert.equal(result.model, payload.model);
    assert.equal(result.stream, true);
    assert.equal(result.temperature, 0.5);
    assert.deepEqual(result.metadata, payload.metadata);
});

test("rejects invalid input", () => {
    assert.throws(
        () => sanitizeResponsesInput(null),
                  TypeError
    );

    assert.throws(
        () => sanitizeResponsesPayload(null),
                  TypeError
    );
});
