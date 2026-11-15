
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import { createServer } from "../server-v3.mjs";
import { UpstreamRequestError } from "../src/request-handler.js";

const config = {
    allowedUserAgentPrefix: "opencode/"
};

async function startTestServer(t, requestHandler) {
    const server = createServer(config, requestHandler);

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

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

    return { server, baseUrl };
}

const validHeaders = {
    "user-agent": "opencode/1.0.0"
};

test("rejects paths outside the v1 API", async (t) => {
    const { baseUrl } = await startTestServer(
        t,
        async () => {
            throw new Error("Handler should not be called.");
        }
    );

    const response = await fetch(`${baseUrl}/invalid`);

    assert.equal(response.status, 404);

    const body = await response.json();
    assert.equal(body.error.message, "Not Found");
});

test("rejects unsupported User-Agent headers", async (t) => {
    const { baseUrl } = await startTestServer(
        t,
        async () => {
            throw new Error("Handler should not be called.");
        }
    );

    const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: {
            "user-agent": "curl/8.0"
        },
        body: "{}"
    });

    assert.equal(response.status, 400);

    const body = await response.json();

    assert.match(
        body.error.message,
        /User-Agent/
    );
});

test("forwards HTTP request details to the request handler", async (t) => {
    let receivedRequest;

    const { baseUrl } = await startTestServer(
        t,
        async (request) => {
            receivedRequest = request;

            return {
                status: 200,
                headers: {
                    "content-type": "application/json"
                },
                body: (async function* () {
                    yield Buffer.from('{"ok":true}');
                })(),
                                              requestId: "test-request-1"
            };
        }
    );

    const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: {
            ...validHeaders,
            "content-type": "application/json"
        },
        body: JSON.stringify({
            model: "test-model",
            input: "Hello"
        })
    });

    assert.equal(response.status, 200);

    assert.equal(receivedRequest.method, "POST");
    assert.equal(receivedRequest.path, "/v1/responses");
    assert.equal(
        receivedRequest.headers["user-agent"],
        "opencode/1.0.0"
    );

    assert.deepEqual(
        JSON.parse(receivedRequest.body.toString("utf8")),
                     {
                         model: "test-model",
                         input: "Hello"
                     }
    );

    assert.equal(
        await response.text(),
                 '{"ok":true}'
    );
});

test("preserves upstream error status and request ID", async (t) => {
    const { baseUrl } = await startTestServer(
        t,
        async () => {
            throw new UpstreamRequestError(
                401,
                {
                    error: {
                        message: "Invalid API key"
                    }
                },
                "upstream-request-123"
            );
        }
    );

    const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: validHeaders,
        body: "{}"
    });

    assert.equal(response.status, 401);

    assert.equal(
        response.headers.get("x-proxy-request-id"),
                 "upstream-request-123"
    );

    const body = await response.json();

    assert.equal(
        body.error.message,
        "Invalid API key"
    );
});

test("returns 502 when the request handler fails unexpectedly", async (t) => {
    const { baseUrl } = await startTestServer(
        t,
        async () => {
            throw new Error("Unexpected internal failure");
        }
    );

    const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: validHeaders,
        body: "{}"
    });

    assert.equal(response.status, 502);

    const body = await response.json();

    assert.equal(
        body.error.message,
        "The proxy could not complete the upstream request."
    );
});

test("handles an empty upstream response body", async (t) => {
    const { baseUrl } = await startTestServer(
        t,
        async () => ({
            status: 204,
            headers: {},
            body: null,
            requestId: "empty-response"
        })
    );

    const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: validHeaders,
        body: "{}"
    });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
});
