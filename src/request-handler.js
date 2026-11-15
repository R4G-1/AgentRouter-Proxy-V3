
/**
 * AgentRouter Proxy V3
 * Request Handler
 */

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { detectUpstreamError } from "./error-detector.js";
import { getRetryDecision } from "./retry-manager.js";
import { sanitizeResponsesPayload } from "./responses-sanitizer.js";
import { SessionManager } from "./session-manager.js";
import { StreamInspector } from "./stream-inspector.js";
import { logger } from "./logger.js";

function parseErrorBody(text) {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function getRequestId(response) {
    return (
        response.headers.get("x-request-id") ||
        response.headers.get("request-id") ||
        "unknown"
    );
}

function getRetryAfterMs(response) {
    const value = response.headers.get("retry-after");

    if (!value) return 0;

    const seconds = Number(value);

    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }

    const date = Date.parse(value);

    return Number.isNaN(date)
    ? 0
    : Math.max(0, date - Date.now());
}

function isResponsesEndpoint(path) {
    return /^\/v1\/responses(?:\?|$)/.test(path);
}

function parseRequestPayload(body) {
    if (typeof body === "string") {
        return JSON.parse(body);
    }

    if (Buffer.isBuffer(body)) {
        return JSON.parse(body.toString("utf8"));
    }

    if (body instanceof Uint8Array) {
        return JSON.parse(Buffer.from(body).toString("utf8"));
    }

    if (body && typeof body === "object") {
        return structuredClone(body);
    }

    throw new TypeError("Cannot sanitize an invalid request body.");
}

function normalizeRequestBody(body) {
    if (body === undefined) {
        return Buffer.alloc(0);
    }

    if (
        typeof body === "string" ||
        Buffer.isBuffer(body) ||
        body instanceof Uint8Array
    ) {
        return body;
    }

    if (typeof body === "object") {
        return Buffer.from(JSON.stringify(body));
    }

    throw new TypeError("Request body must be a string, buffer, or object.");
}

function serializePayload(payload) {
    return Buffer.from(JSON.stringify(payload));
}

function extractResponseId(event) {
    const data = event?.parsed?.data;

    if (
        data?.type === "response.completed" &&
        typeof data.response?.id === "string"
    ) {
        return data.response.id;
    }

    return null;
}

async function waitForRetry(delayMs, signal, sleepImpl) {
    if (signal?.aborted) {
        throw signal.reason || new Error("Request aborted.");
    }

    try {
        await sleepImpl(
            delayMs,
            undefined,
            signal ? { signal } : undefined
        );
    } catch (error) {
        if (signal?.aborted) {
            throw signal.reason || error;
        }

        throw error;
    }

    if (signal?.aborted) {
        throw signal.reason || new Error("Request aborted.");
    }
}

function createInspectedStream(
    upstreamBody,
    inspector,
    sessionManager,
    sessionId,
    loggerImpl
) {
    return async function* () {
        for await (const chunk of upstreamBody) {
            const events = inspector.push(chunk);

            for (const event of events) {
                if (event.type === "error") {
                    loggerImpl.error("Error detected inside SSE stream.", {
                        category: event.error.category,
                        message: event.error.message
                    });
                }

                const responseId = extractResponseId(event);

                if (responseId && sessionId) {
                    sessionManager.setPreviousResponseId(
                        sessionId,
                        responseId
                    );
                }
            }

            yield chunk;
        }

        const finalEvents = inspector.finish();

        for (const event of finalEvents) {
            if (event.type === "error") {
                loggerImpl.error("Error detected in final SSE event.", {
                    message: event.error.message
                });
            }

            const responseId = extractResponseId(event);

            if (responseId && sessionId) {
                sessionManager.setPreviousResponseId(
                    sessionId,
                    responseId
                );
            }
        }
    };
}

export class UpstreamRequestError extends Error {
    constructor(status, body, requestId) {
        super(`AgentRouter returned HTTP ${status}`);

        this.name = "UpstreamRequestError";
        this.status = status;
        this.body = body;
        this.requestId = requestId;
    }
}

export function createRequestHandler({
    config,
    sessionManager = new SessionManager(),
                                     fetchImpl = fetch,
                                     sleepImpl = sleep,
                                     loggerImpl = logger
}) {
    if (!config?.apiKey) {
        throw new Error("Request handler requires an API key.");
    }

    if (
        typeof config.upstream !== "string" ||
        !["http:", "https:"].includes(new URL(config.upstream).protocol)
    ) {
        throw new Error("A valid HTTP(S) upstream URL is required.");
    }

    if (typeof fetchImpl !== "function") {
        throw new TypeError("fetchImpl must be a function.");
    }

    return async function handleRequest(request) {
        const {
            method = "POST",
            path,
            headers = {},
            body,
            sessionId = null,
            signal
        } = request;

        if (typeof method !== "string" || !method.trim()) {
            throw new TypeError("A valid HTTP method is required.");
        }

        if (typeof path !== "string" || !path.startsWith("/v1/")) {
            throw new TypeError("A valid /v1/ request path is required.");
        }

        const normalizedMethod = method.toUpperCase();

        const clientUserAgent = headers["user-agent"];

        if (
            typeof clientUserAgent !== "string" ||
            !clientUserAgent.toLowerCase().startsWith(
                config.allowedUserAgentPrefix || "opencode/"
            )
        ) {
            throw new Error("Missing or unsupported OpenCode User-Agent.");
        }

        const upstreamUrl = new URL(path, config.upstream);

        if (
            upstreamUrl.origin !== new URL(config.upstream).origin ||
            !upstreamUrl.pathname.startsWith("/v1/")
        ) {
            throw new Error("Invalid upstream request destination.");
        }

        const upstreamHeaders = {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": headers["content-type"] || "application/json",
            "user-agent": clientUserAgent,
            "x-client-request-id":
            headers["x-client-request-id"] || randomUUID()
        };

        if (headers.accept) {
            upstreamHeaders.accept = headers.accept;
        }

        if (headers["openai-beta"]) {
            upstreamHeaders["openai-beta"] = headers["openai-beta"];
        }

        let requestBody = ["GET", "HEAD"].includes(normalizedMethod)
        ? undefined
        : normalizeRequestBody(body);

        const maxAttempts = config.maxAttempts || 3;
        const startedAt = Date.now();

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (signal?.aborted) {
                throw signal.reason || new Error("Request aborted.");
            }

            loggerImpl.request(
                normalizedMethod,
                path,
                attempt,
                maxAttempts
            );

            let upstream;

            try {
                const timeoutSignal = AbortSignal.timeout(
                    config.timeoutMs || 300000
                );

                const combinedSignal = signal
                ? AbortSignal.any([signal, timeoutSignal])
                : timeoutSignal;

                upstream = await fetchImpl(upstreamUrl, {
                    method: normalizedMethod,
                    headers: upstreamHeaders,
                    body: requestBody,
                    signal: combinedSignal
                });
            } catch (error) {
                if (signal?.aborted) {
                    throw signal.reason || error;
                }

                const networkError = {
                    category: "network_error",
                    retryable: true,
                    requiresSanitization: false,
                    message: error.message
                };

                const decision = getRetryDecision(
                    networkError,
                    attempt,
                    { maxAttempts }
                );

                if (!decision.retry) {
                    throw error;
                }

                loggerImpl.warn(
                    `Network failure. Retrying in ${decision.delayMs}ms.`
                );

                await waitForRetry(
                    decision.delayMs,
                    signal,
                    sleepImpl
                );
                continue;
            }

            const requestId = getRequestId(upstream);

            if (!upstream.ok) {
                const errorText = await upstream.text();
                const errorBody = parseErrorBody(errorText);

                const detectedError = detectUpstreamError(
                    upstream.status,
                    errorBody
                );

                const retryAfterMs = getRetryAfterMs(upstream);

                const decision = getRetryDecision(
                    detectedError,
                    attempt,
                    {
                        maxAttempts,
                        retryAfterMs
                    }
                );

                if (
                    decision.retry &&
                    decision.requiresSanitization
                ) {
                    if (
                        !isResponsesEndpoint(path) ||
                        normalizedMethod !== "POST"
                    ) {
                        throw new UpstreamRequestError(
                            upstream.status,
                            errorBody,
                            requestId
                        );
                    }

                    try {
                        const payload = parseRequestPayload(requestBody);
                        const sanitized = sanitizeResponsesPayload(payload);

                        requestBody = serializePayload(sanitized);

                        if (sessionId) {
                            sessionManager.invalidateSession(sessionId);
                        }

                        loggerImpl.warn(
                            "Resource mismatch detected. Request sanitized before retry."
                        );
                    } catch (error) {
                        loggerImpl.error(
                            "Could not sanitize the failed Responses request.",
                            { message: error.message }
                        );

                        throw new UpstreamRequestError(
                            upstream.status,
                            errorBody,
                            requestId
                        );
                    }
                }

                if (!decision.retry) {
                    throw new UpstreamRequestError(
                        upstream.status,
                        errorBody,
                        requestId
                    );
                }

                loggerImpl.warn(
                    `Upstream error: ${detectedError.category}. Retrying in ${decision.delayMs}ms.`
                );

                await waitForRetry(
                    decision.delayMs,
                    signal,
                    sleepImpl
                );

                continue;
            }

            const inspector = new StreamInspector();

            const responseHeaders = {
                "content-type":
                upstream.headers.get("content-type") ||
                "application/octet-stream",
                "cache-control": "no-cache",
                "x-proxy-request-id": requestId
            };

            const responseBody = upstream.body
            ? createInspectedStream(
                upstream.body,
                inspector,
                sessionManager,
                sessionId,
                loggerImpl
            )()
            : null;

            loggerImpl.info(
                `Upstream accepted request | HTTP ${upstream.status} | Request ID: ${requestId}`
            );

            return {
                status: upstream.status,
                headers: responseHeaders,
                body: responseBody,
                inspector,
                requestId,
                elapsedMs: Date.now() - startedAt
            };
        }

        throw new Error("Request attempts exhausted.");
    };
}
