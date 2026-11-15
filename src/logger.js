
/**
 * AgentRouter Proxy V3
 * Logger
 */

function timestamp() {
    return new Date().toISOString();
}

function write(level, message, details) {
    const prefix = `[${timestamp()}] [${level}]`;

    if (details === undefined) {
        console.log(`${prefix} ${message}`);
        return;
    }

    console.log(`${prefix} ${message}`, details);
}

export const logger = Object.freeze({
    info(message, details) {
        write("INFO", message, details);
    },

    warn(message, details) {
        write("WARN", message, details);
    },

    error(message, details) {
        write("ERROR", message, details);
    },

    request(method, path, attempt, maxAttempts) {
        write(
            "REQUEST",
            `${method} ${path} | Attempt ${attempt}/${maxAttempts}`
        );
    },

    response(status, requestId, elapsedMs) {
        write(
            "RESPONSE",
            `HTTP ${status} | Request ID: ${requestId} | ${elapsedMs}ms`
        );
    }
});
