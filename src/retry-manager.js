
/**
 * AgentRouter Proxy V3
 * Retry Manager
 */

export const DEFAULT_MAX_ATTEMPTS = 3;

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

export function calculateRetryDelay(attempt, retryAfterMs = 0) {
    if (!Number.isInteger(attempt) || attempt < 1) {
        throw new RangeError("Attempt must be a positive integer.");
    }

    const exponentialDelay = Math.min(
        BASE_DELAY_MS * 2 ** (attempt - 1),
                                      MAX_DELAY_MS
    );

    const requestedDelay = Number.isFinite(retryAfterMs)
    ? Math.max(0, retryAfterMs)
    : 0;

    return Math.min(
        Math.max(exponentialDelay, requestedDelay),
                    MAX_DELAY_MS
    );
}

export function getRetryDecision(
    error,
    attempt,
    options = {}
) {
    const {
        maxAttempts = DEFAULT_MAX_ATTEMPTS,
        responseStarted = false,
        retryAfterMs = 0
    } = options;

    if (!Number.isInteger(attempt) || attempt < 1) {
        throw new RangeError("Attempt must be a positive integer.");
    }

    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new RangeError("maxAttempts must be a positive integer.");
    }

    if (responseStarted) {
        return {
            retry: false,
            reason: "response_started",
            delayMs: 0,
            requiresSanitization: false
        };
    }

    if (!error || error.retryable !== true) {
        return {
            retry: false,
            reason: "not_retryable",
            delayMs: 0,
            requiresSanitization: false
        };
    }

    if (attempt >= maxAttempts) {
        return {
            retry: false,
            reason: "max_attempts_reached",
            delayMs: 0,
            requiresSanitization: false
        };
    }

    return {
        retry: true,
        reason: error.category || "unknown",
        delayMs: calculateRetryDelay(attempt, retryAfterMs),
        requiresSanitization: error.requiresSanitization === true
    };
}
