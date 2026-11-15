
import test from "node:test";
import assert from "node:assert/strict";

import {
    getConfig,
    validateConfig
} from "../src/config.js";

test("uses the V3 default port", () => {
    const config = getConfig({});

    assert.equal(config.port, 8788);
});

test("uses the default upstream URL", () => {
    const config = getConfig({});

    assert.equal(config.upstream, "https://agentrouter.org");
});

test("reads custom configuration values", () => {
    const config = getConfig({
        PROXY_PORT: "9000",
        AGENTROUTER_UPSTREAM: "https://example.com/",
        AGENTROUTER_API_KEY: "test-key",
        MAX_ATTEMPTS: "5",
        TIMEOUT_MS: "60000"
    });

    assert.equal(config.port, 9000);
    assert.equal(config.upstream, "https://example.com");
    assert.equal(config.maxAttempts, 5);
    assert.equal(config.timeoutMs, 60000);
});

test("rejects an invalid port", () => {
    assert.throws(
        () => getConfig({ PROXY_PORT: "invalid" }),
                  /PROXY_PORT/
    );
});

test("rejects zero attempts", () => {
    assert.throws(
        () => getConfig({ MAX_ATTEMPTS: "0" }),
                  /MAX_ATTEMPTS/
    );
});

test("rejects a missing API key", () => {
    const config = getConfig({});

    assert.throws(
        () => validateConfig(config),
                  /AGENTROUTER_API_KEY/
    );
});

test("accepts a valid configuration", () => {
    const config = getConfig({
        AGENTROUTER_API_KEY: "test-key"
    });

    assert.equal(validateConfig(config), config);
});

test("rejects unsupported upstream protocols", () => {
    const config = getConfig({
        AGENTROUTER_API_KEY: "test-key",
        AGENTROUTER_UPSTREAM: "ftp://example.com"
    });

    assert.throws(
        () => validateConfig(config),
                  /HTTP or HTTPS/
    );
});
