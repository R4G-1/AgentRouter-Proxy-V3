
import test from "node:test";
import assert from "node:assert/strict";

import {
    detectUpstreamError
} from "../src/error-detector.js";

test("detects resource mismatch", () => {
    const result = detectUpstreamError(400, {
        error: {
            message:
            "The requested item was created under a different OpenAI resource. Use the same resource that created the item."
        }
    });

    assert.equal(result.category, "resource_mismatch");
    assert.equal(result.retryable, true);
    assert.equal(result.requiresSanitization, true);
});

test("detects rate limits", () => {
    const result = detectUpstreamError(429, {
        error: { message: "Rate limit exceeded" }
    });

    assert.equal(result.category, "rate_limit");
    assert.equal(result.retryable, true);
    assert.equal(result.requiresSanitization, false);
});

test("detects server errors", () => {
    const result = detectUpstreamError(502, {
        error: { message: "Bad gateway" }
    });

    assert.equal(result.category, "server_error");
    assert.equal(result.retryable, true);
});

test("does not retry authentication errors", () => {
    const result = detectUpstreamError(401, {
        error: { message: "Invalid API key" }
    });

    assert.equal(result.category, "authentication");
    assert.equal(result.retryable, false);
});

test("does not retry ordinary bad requests", () => {
    const result = detectUpstreamError(400, {
        error: { message: "Invalid request body" }
    });

    assert.equal(result.category, "bad_request");
    assert.equal(result.retryable, false);
});

test("handles string error messages", () => {
    const result = detectUpstreamError(400, {
        error: "Invalid request"
    });

    assert.equal(result.message, "Invalid request");
    assert.equal(result.category, "bad_request");
});

test("handles unknown errors", () => {
    const result = detectUpstreamError(418, {
        message: "Unknown response"
    });

    assert.equal(result.category, "unknown");
    assert.equal(result.retryable, false);
});
