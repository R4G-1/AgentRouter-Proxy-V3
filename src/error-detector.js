
/**
 * AgentRouter Proxy V3
 * Upstream Error Detector
 */

function extractErrorMessage(body) {
    if (typeof body === "string") {
        return body;
    }

    if (!body || typeof body !== "object") {
        return "";
    }

    const error = body.error;

    if (typeof error === "string") {
        return error;
    }

    if (error && typeof error === "object") {
        return [
            error.message,
            error.code,
            error.type
        ]
        .filter(Boolean)
        .join(" ");
    }

    return [
        body.message,
        body.code,
        body.type
    ]
    .filter(Boolean)
    .join(" ");
}

export function detectUpstreamError(status, body) {
    const message = extractErrorMessage(body);
    const normalized = message.toLowerCase();

    const resourceMismatch =
    normalized.includes("different") &&
    normalized.includes("resource") &&
    (
        normalized.includes("created") ||
        normalized.includes("same resource")
    );

    if (resourceMismatch) {
        return {
            category: "resource_mismatch",
            retryable: true,
            requiresSanitization: true,
            status,
            message
        };
    }

    if (status === 429) {
        return {
            category: "rate_limit",
            retryable: true,
            requiresSanitization: false,
            status,
            message
        };
    }

    if (status >= 500 && status <= 599) {
        return {
            category: "server_error",
            retryable: true,
            requiresSanitization: false,
            status,
            message
        };
    }

    if (status === 401 || status === 403) {
        return {
            category: "authentication",
            retryable: false,
            requiresSanitization: false,
            status,
            message
        };
    }

    if (status === 400) {
        return {
            category: "bad_request",
            retryable: false,
            requiresSanitization: false,
            status,
            message
        };
    }

    return {
        category: "unknown",
        retryable: false,
        requiresSanitization: false,
        status,
        message
    };
}
