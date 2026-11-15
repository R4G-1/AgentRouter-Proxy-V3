
/**
 * AgentRouter Proxy V3
 * Configuration
 */

function readPositiveInteger(value, fallback, name) {
    if (value === undefined || value === "") {
        return fallback;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${name} must be a positive integer.`);
    }

    return parsed;
}

export function getConfig(env = process.env) {
    const apiKey = env.AGENTROUTER_API_KEY;

    return Object.freeze({
        port: readPositiveInteger(env.PROXY_PORT, 8788, "PROXY_PORT"),
                         host: "127.0.0.1",
                         upstream: (env.AGENTROUTER_UPSTREAM || "https://agentrouter.org")
                         .replace(/\/+$/, ""),
                         apiKey,
                         maxAttempts: readPositiveInteger(
                             env.MAX_ATTEMPTS,
                             3,
                             "MAX_ATTEMPTS"
                         ),
                         timeoutMs: readPositiveInteger(
                             env.TIMEOUT_MS,
                             300000,
                             "TIMEOUT_MS"
                         ),
                         allowedUserAgentPrefix: "opencode/"
    });
}

export function validateConfig(config) {
    if (!config.apiKey || !config.apiKey.trim()) {
        throw new Error("Missing AGENTROUTER_API_KEY environment variable.");
    }

    let upstreamUrl;

    try {
        upstreamUrl = new URL(config.upstream);
    } catch {
        throw new Error("AGENTROUTER_UPSTREAM must be a valid URL.");
    }

    if (!["http:", "https:"].includes(upstreamUrl.protocol)) {
        throw new Error("AGENTROUTER_UPSTREAM must use HTTP or HTTPS.");
    }

    return config;
}
