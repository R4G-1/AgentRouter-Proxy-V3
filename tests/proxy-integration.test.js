
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { once } from "node:events";

import { createServer } from "../server-v3.mjs";
import { createRequestHandler } from "../src/request-handler.js";

const API_KEY = "integration-test-key";

async function startHttpServer(server, t) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;

    t.after(async () => {
        server.closeAllConnections();

        if (server.listening) {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        }
    });

    return url;
}

function createTestLogger() {
    return {
        request() {},
        info() {},
        warn() {},
        error() {}
    };
}

async function createTestProxy(t, upstreamHandler) {
    const upstreamServer = http.createServer(upstreamHandler);
    const upstreamUrl = await startHttpServer(upstreamServer, t);

    const config = {
        apiKey: API_KEY,
        upstream: upstreamUrl,
        maxAttempts: 3,
        timeoutMs: 5000,
        port: 0,
        host: "127.0.0.1",
        allowedUserAgentPrefix: "opencode/"
    };

    const requestHandler = createRequestHandler({
        config,
        sleepImpl: async () => {},
                                                loggerImpl: createTestLogger()
    });

    const proxyServer = createServer(
        config,
        requestHandler
    );

    const proxyUrl = await startHttpServer(proxyServer, t);

    return {
        upstreamUrl,
        proxyUrl
    };
}

test("completes a full HTTP proxy request", async (t) => {
    let receivedAuthorization;
    let receivedBody;
    let receivedUserAgent;

    const { proxyUrl } = await createTestProxy(
        t,
        async (req, res) => {
            receivedAuthorization = req.headers.authorization;
            receivedUserAgent = req.headers["user-agent"];

            const chunks = [];

            for await (const chunk of req) {
                chunks.push(chunk);
            }

            receivedBody = JSON.parse(
                Buffer.concat(chunks).toString("utf8")
            );

            res.writeHead(200, {
                "content-type": "application/json"
            });

            res.end(JSON.stringify({
                id: "resp_integration_1",
                status: "completed"
            }));
        }
    );

    const response = await fetch(
        `${proxyUrl}/v1/responses`,
        {
            method: "POST",
            headers: {
                "user-agent": "opencode/1.0.0",
                "content-type": "application/json"
            },
            body: JSON.stringify({
                model: "test-model",
                input: "Integration test"
            })
        }
    );

    assert.equal(response.status, 200);

    assert.equal(
        receivedAuthorization,
        `Bearer ${API_KEY}`
    );

    assert.equal(
        receivedUserAgent,
        "opencode/1.0.0"
    );

    assert.deepEqual(receivedBody, {
        model: "test-model",
        input: "Integration test"
    });

    const result = await response.json();

    assert.equal(result.id, "resp_integration_1");
    assert.equal(result.status, "completed");
});

test("recovers from an upstream server error", async (t) => {
    let attempts = 0;

    const { proxyUrl } = await createTestProxy(
        t,
        async (_req, res) => {
            attempts++;

            if (attempts === 1) {
                res.writeHead(500, {
                    "content-type": "application/json"
                });

                res.end(JSON.stringify({
                    error: {
                        message: "Internal server error"
                    }
                }));

                return;
            }

            res.writeHead(200, {
                "content-type": "application/json"
            });

            res.end(JSON.stringify({
                success: true
            }));
        }
    );

    const response = await fetch(
        `${proxyUrl}/v1/responses`,
        {
            method: "POST",
            headers: {
                "user-agent": "opencode/1.0.0",
                "content-type": "application/json"
            },
            body: JSON.stringify({
                model: "test-model",
                input: "Retry test"
            })
        }
    );

    assert.equal(response.status, 200);
    assert.equal(attempts, 2);

    const result = await response.json();

    assert.equal(result.success, true);
});

test("recovers from a resource mismatch through the full proxy", async (t) => {
    let attempts = 0;
    let secondRequestBody;

    const { proxyUrl } = await createTestProxy(
        t,
        async (req, res) => {
            attempts++;

            const chunks = [];

            for await (const chunk of req) {
                chunks.push(chunk);
            }

            const body = JSON.parse(
                Buffer.concat(chunks).toString("utf8")
            );

            if (attempts === 1) {
                res.writeHead(400, {
                    "content-type": "application/json"
                });

                res.end(JSON.stringify({
                    error: {
                        message:
                        "The requested item was created under a different OpenAI resource. Use the same resource that created the item to access it."
                    }
                }));

                return;
            }

            secondRequestBody = body;

            res.writeHead(200, {
                "content-type": "application/json"
            });

            res.end(JSON.stringify({
                recovered: true
            }));
        }
    );

    const response = await fetch(
        `${proxyUrl}/v1/responses`,
        {
            method: "POST",
            headers: {
                "user-agent": "opencode/1.0.0",
                "content-type": "application/json"
            },
            body: JSON.stringify({
                model: "test-model",
                previous_response_id: "resp_from_old_resource",
                input: "Recovery test"
            })
        }
    );

    assert.equal(response.status, 200);
    assert.equal(attempts, 2);

    assert.equal(
        Object.hasOwn(secondRequestBody, "previous_response_id"),
                 false
    );

    const result = await response.json();

    assert.equal(result.recovered, true);
});

test("forwards upstream streaming responses", async (t) => {
    const streamData =
    'data: {"type":"response.completed","response":{"id":"resp_stream_test"}}\n\n';

    const { proxyUrl } = await createTestProxy(
        t,
        async (_req, res) => {
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache"
            });

            res.end(streamData);
        }
    );

    const response = await fetch(
        `${proxyUrl}/v1/responses`,
        {
            method: "POST",
            headers: {
                "user-agent": "opencode/1.0.0",
                "content-type": "application/json",
                accept: "text/event-stream"
            },
            body: JSON.stringify({
                model: "test-model",
                input: "Stream test",
                stream: true
            })
        }
    );

    assert.equal(response.status, 200);

    assert.match(
        response.headers.get("content-type"),
                 /text\/event-stream/
    );

    assert.equal(
        await response.text(),
                 streamData
    );
});

test("rejects request bodies larger than 10 MB", async (t) => {
    let upstreamReached = false;

    const { proxyUrl } = await createTestProxy(
        t,
        async (_req, res) => {
            upstreamReached = true;
            res.writeHead(200);
            res.end("Unexpected upstream request");
        }
    );

    const oversizedBody = Buffer.alloc(
        10 * 1024 * 1024 + 1,
        "a"
    );

    const response = await fetch(
        `${proxyUrl}/v1/responses`,
        {
            method: "POST",
            headers: {
                "user-agent": "opencode/1.0.0",
                "content-type": "application/json"
            },
            body: oversizedBody
        }
    );

    assert.equal(response.status, 413);
    assert.equal(upstreamReached, false);

    const result = await response.json();

    assert.match(
        result.error.message,
        /10 MB/
    );
});
