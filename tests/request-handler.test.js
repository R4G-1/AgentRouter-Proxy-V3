
import test from "node:test";
import assert from "node:assert/strict";

import {
    createRequestHandler,
    UpstreamRequestError
} from "../src/request-handler.js";

const config = {
    apiKey: "test-api-key",
    upstream: "https://agentrouter.org",
    maxAttempts: 3,
    timeoutMs: 5000,
    allowedUserAgentPrefix: "opencode/"
};

const request = {
    method: "POST",
    path: "/v1/responses",
    headers: {
        "user-agent": "opencode/1.0.0",
        "content-type": "application/json"
    },
    body: JSON.stringify({
        model: "test-model",
        input: "Hello"
    })
};

function createLogger() {
    return {
        request() {},
        info() {},
        warn() {},
        error() {}
    };
}

function createHandler(fetchImpl, options = {}) {
    return createRequestHandler({
        config,
        fetchImpl,
        sleepImpl: async () => {},
                                loggerImpl: createLogger(),
                                ...options
    });
}

test("sends a request to the configured upstream", async () => {
    let receivedUrl;

    const handler = createHandler(async (url) => {
        receivedUrl = url;

        return new Response("OK", {
            status: 200
        });
    });

    const result = await handler(request);

    assert.equal(
        receivedUrl.href,
        "https://agentrouter.org/v1/responses"
    );

    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "text/plain;charset=UTF-8");
});

test("forwards the API key and OpenCode User-Agent", async () => {
    let receivedHeaders;

    const handler = createHandler(async (_url, options) => {
        receivedHeaders = options.headers;

        return new Response("OK");
    });

    await handler(request);

    assert.equal(
        receivedHeaders.authorization,
        "Bearer test-api-key"
    );

    assert.equal(
        receivedHeaders["user-agent"],
        "opencode/1.0.0"
    );
});

test("rejects requests with an unsupported User-Agent", async () => {
    const handler = createHandler(async () => {
        throw new Error("Fetch should not be called.");
    });

    await assert.rejects(
        handler({
            ...request,
            headers: {
                "user-agent": "curl/8.0"
            }
        }),
        /OpenCode User-Agent/
    );
});

test("rejects paths outside the v1 API", async () => {
    const handler = createHandler(async () => {
        throw new Error("Fetch should not be called.");
    });

    await assert.rejects(
        handler({
            ...request,
            path: "/admin"
        }),
        /valid \/v1\//
    );
});

test("retries after a temporary network failure", async () => {
    let attempts = 0;

    const handler = createHandler(async () => {
        attempts++;

        if (attempts === 1) {
            throw new Error("Temporary network failure");
        }

        return new Response("OK");
    });

    const result = await handler(request);

    assert.equal(attempts, 2);
    assert.equal(result.status, 200);
});

test("sanitizes a resource mismatch before retrying", async () => {
    let attempts = 0;
    let secondRequestBody;

    const handler = createHandler(async (_url, options) => {
        attempts++;

        if (attempts === 1) {
            return new Response(
                JSON.stringify({
                    error: {
                        message:
                        "The requested item was created under a different OpenAI resource. Use the same resource that created the item to access it."
                    }
                }),
                {
                    status: 400,
                    headers: {
                        "content-type": "application/json"
                    }
                }
            );
        }

        secondRequestBody = JSON.parse(
            Buffer.from(options.body).toString("utf8")
        );

        return new Response("Recovered", {
            status: 200
        });
    });

    const originalRequest = {
        ...request,
        body: JSON.stringify({
            model: "test-model",
            previous_response_id: "resp_old",
            input: [
                {
                    type: "message",
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: "Hello"
                        }
                    ]
                }
            ]
        })
    };

    const result = await handler(originalRequest);

    assert.equal(attempts, 2);
    assert.equal(result.status, 200);

    assert.equal(
        Object.hasOwn(secondRequestBody, "previous_response_id"),
                 false
    );
});

test("does not retry authentication errors", async () => {
    let attempts = 0;

    const handler = createHandler(async () => {
        attempts++;

        return new Response(
            JSON.stringify({
                error: {
                    message: "Invalid API key"
                }
            }),
            {
                status: 401,
                headers: {
                    "content-type": "application/json"
                }
            }
        );
    });

    await assert.rejects(
        handler(request),
                         (error) => {
                             assert.ok(error instanceof UpstreamRequestError);
                             assert.equal(error.status, 401);
                             return true;
                         }
    );

    assert.equal(attempts, 1);
});

test("does not retry resource mismatch on non-Responses endpoints", async () => {
    let attempts = 0;

    const handler = createHandler(async () => {
        attempts++;

        return new Response(
            JSON.stringify({
                error: {
                    message:
                    "The requested item was created under a different OpenAI resource. Use the same resource that created the item to access it."
                }
            }),
            {
                status: 400,
                headers: {
                    "content-type": "application/json"
                }
            }
        );
    });

    await assert.rejects(
        handler({
            ...request,
            path: "/v1/chat/completions"
        }),
        UpstreamRequestError
    );

    assert.equal(attempts, 1);
});

test("preserves the upstream error status and body", async () => {
    const errorBody = {
        error: {
            message: "Invalid request"
        }
    };

    const handler = createHandler(async () => {
        return new Response(JSON.stringify(errorBody), {
            status: 400,
            headers: {
                "content-type": "application/json",
                "x-request-id": "test-request-id"
            }
        });
    });

    await assert.rejects(
        handler(request),
                         (error) => {
                             assert.ok(error instanceof UpstreamRequestError);
                             assert.equal(error.status, 400);
                             assert.equal(error.requestId, "test-request-id");
                             assert.deepEqual(error.body, errorBody);
                             return true;
                         }
    );
});

test("returns a readable response stream", async () => {
    const handler = createHandler(async () => {
        return new Response("Stream test", {
            status: 200
        });
    });

    const result = await handler(request);

    assert.ok(result.body);

    let output = "";

    for await (const chunk of result.body) {
        output += Buffer.from(chunk).toString("utf8");
    }

    assert.equal(output, "Stream test");
});

test("serializes JavaScript object request bodies", async () => {
    let receivedBody;

    const handler = createHandler(async (_url, options) => {
        receivedBody = options.body;

        return new Response("OK");
    });

    await handler({
        ...request,
        body: {
            model: "test-model",
            input: "Hello"
        }
    });

    assert.ok(Buffer.isBuffer(receivedBody));

    assert.deepEqual(
        JSON.parse(receivedBody.toString("utf8")),
                     {
                         model: "test-model",
                         input: "Hello"
                     }
    );
});

test("invalidates the session after a resource mismatch", async () => {
    let attempts = 0;
    let invalidatedSession = null;

    const sessionManager = {
        invalidateSession(sessionId) {
            invalidatedSession = sessionId;
        }
    };

    const handler = createHandler(async () => {
        attempts++;

        if (attempts === 1) {
            return new Response(
                JSON.stringify({
                    error: {
                        message:
                        "The requested item was created under a different OpenAI resource. Use the same resource that created the item to access it."
                    }
                }),
                {
                    status: 400,
                    headers: {
                        "content-type": "application/json"
                    }
                }
            );
        }

        return new Response("Recovered");
    }, { sessionManager });

    await handler({
        ...request,
        sessionId: "session-test-123"
    });

    assert.equal(attempts, 2);
    assert.equal(invalidatedSession, "session-test-123");
});

test("respects Retry-After on rate limit responses", async () => {
    let attempts = 0;
    const delays = [];

    const handler = createHandler(async () => {
        attempts++;

        if (attempts === 1) {
            return new Response(
                JSON.stringify({
                    error: {
                        message: "Rate limit exceeded"
                    }
                }),
                {
                    status: 429,
                    headers: {
                        "content-type": "application/json",
                        "retry-after": "2"
                    }
                }
            );
        }

        return new Response("Recovered");
    }, {
        sleepImpl: async (delay) => {
            delays.push(delay);
        }
    });

    const result = await handler(request);

    assert.equal(result.status, 200);
    assert.equal(attempts, 2);
    assert.deepEqual(delays, [2000]);
});

test("retries server errors without sanitizing the request", async () => {
    let attempts = 0;
    const receivedBodies = [];

    const handler = createHandler(async (_url, options) => {
        attempts++;
        receivedBodies.push(
            Buffer.from(options.body).toString("utf8")
        );

        if (attempts === 1) {
            return new Response(
                JSON.stringify({
                    error: {
                        message: "Internal server error"
                    }
                }),
                {
                    status: 500,
                    headers: {
                        "content-type": "application/json"
                    }
                }
            );
        }

        return new Response("Recovered");
    });

    const result = await handler(request);

    assert.equal(result.status, 200);
    assert.equal(attempts, 2);
    assert.equal(receivedBodies[0], receivedBodies[1]);
});

test("stores the completed response ID in the session", async () => {
    let storedSessionId = null;
    let storedResponseId = null;

    const sessionManager = {
        setPreviousResponseId(sessionId, responseId) {
            storedSessionId = sessionId;
            storedResponseId = responseId;
        }
    };

    const handler = createHandler(async () => {
        return new Response(
            'data: {"type":"response.completed","response":{"id":"resp_123"}}\n\n',
            {
                status: 200,
                headers: {
                    "content-type": "text/event-stream"
                }
            }
        );
    }, { sessionManager });

    const result = await handler({
        ...request,
        sessionId: "session-stream-test"
    });

    for await (const _chunk of result.body) {
        // Consume the stream so its events are inspected.
    }

    assert.equal(storedSessionId, "session-stream-test");
    assert.equal(storedResponseId, "resp_123");
});

test("uses the injected logger for successful requests", async () => {
    let loggedMessage = null;

    const loggerImpl = {
        request() {},
     warn() {},
     error() {},
     info(message) {
         loggedMessage = message;
     }
    };

    const handler = createHandler(
        async () => new Response("OK"),
                                  { loggerImpl }
    );

    await handler(request);

    assert.match(
        loggedMessage,
        /Upstream accepted request/
    );
});

test("rejects an invalid HTTP method", async () => {
    const handler = createHandler(async () => {
        throw new Error("Fetch should not be called.");
    });

    await assert.rejects(
        handler({
            ...request,
            method: 123
        }),
        /valid HTTP method/
    );
});

test("does not retry when the request is aborted during retry delay", async () => {
    let attempts = 0;

    const controller = new AbortController();

    const handler = createHandler(
        async () => {
            attempts++;
            throw new Error("Temporary network failure");
        },
        {
            sleepImpl: async () => {
                controller.abort(
                    new Error("Client disconnected.")
                );
            }
        }
    );

    await assert.rejects(
        handler({
            ...request,
            signal: controller.signal
        }),
        /Client disconnected/
    );

    assert.equal(attempts, 1);
});

test("does not retry HTTP errors when the request is aborted during retry delay", async () => {
    let attempts = 0;

    const controller = new AbortController();

    const handler = createHandler(
        async () => {
            attempts++;

            return new Response(
                JSON.stringify({
                    error: {
                        message: "Internal server error"
                    }
                }),
                {
                    status: 500,
                    headers: {
                        "content-type": "application/json"
                    }
                }
            );
        },
        {
            sleepImpl: async () => {
                controller.abort(
                    new Error("Client disconnected.")
                );
            }
        }
    );

    await assert.rejects(
        handler({
            ...request,
            signal: controller.signal
        }),
        /Client disconnected/
    );

    assert.equal(attempts, 1);
});

test("does not forward restricted client headers upstream", async () => {
    let receivedHeaders;

    const handler = createHandler(async (url, options) => {
        receivedHeaders = options.headers;

        return new Response("OK", { status: 200 });
    });

    await handler({
        ...request,
        headers: {
            ...request.headers,
            host: "malicious.example",
            "content-length": "999999",
            cookie: "session=secret",
            connection: "keep-alive"
        }
    });

    assert.equal(receivedHeaders.host, undefined);
    assert.equal(receivedHeaders["content-length"], undefined);
    assert.equal(receivedHeaders.cookie, undefined);
    assert.equal(receivedHeaders.connection, undefined);
});

test("overrides client Authorization with the configured API key", async () => {
    let receivedHeaders;

    const handler = createHandler(async (url, options) => {
        receivedHeaders = options.headers;

        return new Response("OK", { status: 200 });
    });

    await handler({
        ...request,
        headers: {
            ...request.headers,
            authorization: "Bearer malicious-client-key"
        }
    });

    assert.equal(
        receivedHeaders.authorization,
        "Bearer test-api-key"
    );
});


test("rejects path traversal attempts", async (t) => {
    const maliciousPaths = [
        "/v1/../../admin",
        "/v1/%2e%2e/%2e%2e/admin"
    ];

    for (const path of maliciousPaths) {
        await t.test(`rejects ${path}`, async () => {
            let fetchCalled = false;

            const handler = createHandler(async () => {
                fetchCalled = true;
                return new Response("OK", { status: 200 });
            });

            await assert.rejects(
                handler({
                    ...request,
                    path
                }),
                /Invalid upstream request destination/
            );

            assert.equal(fetchCalled, false);
        });
    }
});

test("allows normal Responses API paths", async () => {
    let fetchCalled = false;
    let receivedUrl;

    const handler = createHandler(async (url) => {
        fetchCalled = true;
        receivedUrl = url;

        return new Response("OK", { status: 200 });
    });

    const result = await handler({
        ...request,
        path: "/v1/responses"
    });

    assert.equal(fetchCalled, true);
    assert.equal(receivedUrl.pathname, "/v1/responses");
    assert.equal(result.status, 200);
});
