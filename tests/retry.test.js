
import test from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_MAX_ATTEMPTS,
    calculateRetryDelay,
    getRetryDecision
} from "../src/retry-manager.js";

test("uses three attempts by default", () => {
    assert.equal(DEFAULT_MAX_ATTEMPTS, 3);
});

test("calculates exponential retry delays", () => {
    assert.equal(calculateRetryDelay(1), 500);
    assert.equal(calculateRetryDelay(2), 1000);
    assert.equal(calculateRetryDelay(3), 2000);
    assert.equal(calculateRetryDelay(4), 4000);
});

test("caps retry delay at 8000ms", () => {
    assert.equal(calculateRetryDelay(10), 8000);
});

test("respects Retry-After when it is longer", () => {
    assert.equal(calculateRetryDelay(1, 3000), 3000);
});

test("does not exceed the maximum delay", () => {
    assert.equal(calculateRetryDelay(1, 20000), 8000);
});

test("allows retry for resource mismatch and requests sanitization", () => {
    const result = getRetryDecision(
        {
            category: "resource_mismatch",
            retryable: true,
            requiresSanitization: true
        },
        1
    );

    assert.equal(result.retry, true);
    assert.equal(result.requiresSanitization, true);
    assert.equal(result.reason, "resource_mismatch");
});

test("allows retry for server errors without sanitization", () => {
    const result = getRetryDecision(
        {
            category: "server_error",
            retryable: true,
            requiresSanitization: false
        },
        1
    );

    assert.equal(result.retry, true);
    assert.equal(result.requiresSanitization, false);
});

test("stops after the maximum number of attempts", () => {
    const result = getRetryDecision(
        { retryable: true, category: "server_error" },
        3
    );

    assert.equal(result.retry, false);
    assert.equal(result.reason, "max_attempts_reached");
});

test("never retries after response streaming has started", () => {
    const result = getRetryDecision(
        { retryable: true, category: "server_error" },
        1,
        { responseStarted: true }
    );

    assert.equal(result.retry, false);
    assert.equal(result.reason, "response_started");
});

test("does not retry non-retryable errors", () => {
    const result = getRetryDecision(
        { retryable: false, category: "authentication" },
        1
    );

    assert.equal(result.retry, false);
    assert.equal(result.reason, "not_retryable");
});

test("rejects invalid attempt numbers", () => {
    assert.throws(() => calculateRetryDelay(0), RangeError);
    assert.throws(
        () => getRetryDecision({ retryable: true }, 0),
                  RangeError
    );
});

test("supports custom maximum attempts", () => {
    const result = getRetryDecision(
        { retryable: true, category: "server_error" },
        3,
        { maxAttempts: 5 }
    );

    assert.equal(result.retry, true);
});
