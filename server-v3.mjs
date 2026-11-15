
/**
 * AgentRouter Proxy V3
 * HTTP Server
 */

import http from "node:http";
import { pathToFileURL } from "node:url";

import { getConfig, validateConfig } from "./src/config.js";
import {
    createRequestHandler,
    UpstreamRequestError
} from "./src/request-handler.js";
import { logger } from "./src/logger.js";

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

function sendJson(res, status, payload) {
    if (res.destroyed || res.writableEnded) return;

    const body = Buffer.from(JSON.stringify(payload));

    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": body.length,
        "cache-control": "no-store"
    });

    res.end(body);
}

function normalizeHeaders(headers) {
    const normalized = {};

    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") {
            normalized[key.toLowerCase()] = value;
        } else if (Array.isArray(value)) {
            normalized[key.toLowerCase()] = value.join(", ");
        }
    }

    return normalized;
}

async function readRequestBody(
    req,
    maxBytes = MAX_REQUEST_BODY_BYTES
) {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;

    for await (const chunk of req) {
        if (tooLarge) continue;

        const buffer = Buffer.from(chunk);
        totalBytes += buffer.length;

        if (totalBytes > maxBytes) {
            tooLarge = true;
            chunks.length = 0;
            continue;
        }

        chunks.push(buffer);
    }

    if (tooLarge) {
        return null;
    }

    return Buffer.concat(chunks, totalBytes);
}

async function writeStream(res, body) {
    if (!body) {
        res.end();
        return;
    }

    for await (const chunk of body) {
        if (res.destroyed) {
            throw new Error("Client connection closed during streaming.");
        }

        if (!res.write(chunk)) {
            await new Promise((resolve, reject) => {
                const cleanup = () => {
                    res.off("drain", onDrain);
                    res.off("close", onClose);
                    res.off("error", onError);
                };

                const onDrain = () => {
                    cleanup();
                    resolve();
                };

                const onClose = () => {
                    cleanup();
                    reject(new Error("Client connection closed during streaming."));
                };

                const onError = (error) => {
                    cleanup();
                    reject(error);
                };

                res.once("drain", onDrain);
                res.once("close", onClose);
                res.once("error", onError);
            });
        }
    }

    if (!res.destroyed) {
        res.end();
    }
}

function serializeUpstreamError(error) {
    if (typeof error.body === "string") {
        return {
            body: Buffer.from(error.body),
            contentType: "text/plain; charset=utf-8"
        };
    }

    return {
        body: Buffer.from(JSON.stringify(error.body)),
        contentType: "application/json; charset=utf-8"
    };
}

export function createServer(config, requestHandler) {
    return http.createServer(async (req, res) => {
        const path = req.url || "/";

        if (!path.startsWith("/v1/")) {
            sendJson(res, 404, {
                error: { message: "Not Found" }
            });
            return;
        }

        const headers = normalizeHeaders(req.headers);
        const userAgent = headers["user-agent"] || "";

        if (
            !userAgent.toLowerCase().startsWith(
                config.allowedUserAgentPrefix || "opencode/"
            )
        ) {
            sendJson(res, 400, {
                error: {
                    message: "Unsupported or missing OpenCode User-Agent."
                }
            });
            return;
        }

        const controller = new AbortController();

        const onClientClose = () => {
            if (!res.writableEnded) {
                controller.abort(new Error("Client disconnected."));
            }
        };

        res.once("close", onClientClose);

        try {
            const method = req.method || "POST";

            const body = ["GET", "HEAD"].includes(method.toUpperCase())
            ? undefined
            : await readRequestBody(req);

            if (controller.signal.aborted) return;

            if (body === null) {
                sendJson(res, 413, {
                    error: {
                        message: "Request body exceeds the maximum allowed size of 10 MB."
                    }
                });

                return;
            }

            const result = await requestHandler({
                method,
                path,
                headers,
                body,
                signal: controller.signal
            });

            if (controller.signal.aborted || res.destroyed) return;

            res.writeHead(result.status, result.headers);

            await writeStream(res, result.body);

            logger.info(
                `Client response completed | HTTP ${result.status} | Request ID: ${result.requestId}`
            );
        } catch (error) {
            if (controller.signal.aborted || res.destroyed) return;

            if (error instanceof UpstreamRequestError) {
                const serialized = serializeUpstreamError(error);

                res.writeHead(error.status, {
                    "content-type": serialized.contentType,
                    "content-length": serialized.body.length,
                    "x-proxy-request-id": error.requestId,
                    "cache-control": "no-store"
                });

                res.end(serialized.body);

                logger.warn(
                    `Upstream request rejected | HTTP ${error.status} | Request ID: ${error.requestId}`
                );

                return;
            }

            if (res.headersSent) {
                logger.error("Response stream failed after headers were sent.", {
                    message: error.message
                });

                res.destroy(error);
                return;
            }

            logger.error("Proxy request failed.", {
                message: error.message
            });

            sendJson(res, 502, {
                error: {
                    message: "The proxy could not complete the upstream request."
                }
            });
        } finally {
            res.off("close", onClientClose);
        }
    });
}



export function startServer() {
    let config;

    try {
        config = getConfig();
        validateConfig(config);
    } catch (error) {
        console.error("[V3] Configuration error:", error.message);
        process.exitCode = 1;
        return null;
    }

    const requestHandler = createRequestHandler({ config });
    const server = createServer(config, requestHandler);

    server.on("error", (error) => {
        logger.error("HTTP server error.", {
            message: error.message
        });
    });

    server.listen(config.port, config.host, () => {
        console.log(`
 ▄██████▄   ▄████████         ▄███████▄    ▄████████  ▄██████▄  ▀████    ▐████▀ ▄██   ▄
███    ███ ███    ███        ███    ███   ███    ███ ███    ███   ███▌   ████▀  ███   ██▄
███    ███ ███    █▀         ███    ███   ███    ███ ███    ███    ███  ▐███    ███▄▄▄███
███    ███ ███               ███    ███  ▄███▄▄▄▄██▀ ███    ███    ▀███▄███▀    ▀▀▀▀▀▀███
███    ███ ███             ▀█████████▀  ▀▀███▀▀▀▀▀   ███    ███    ████▀██▄     ▄██   ███
███    ███ ███    █▄         ███        ▀███████████ ███    ███   ▐███  ▀███    ███   ███
███    ███ ███    ███        ███          ███    ███ ███    ███  ▄███     ███▄  ███   ███
 ▀██████▀  ████████▀        ▄████▀        ███    ███  ▀██████▀  ████       ███▄  ▀█████▀
                                          ███    ███
`);

        logger.info(
            `AgentRouter Proxy V3 listening on http://${config.host}:${config.port}`
        );

        logger.info(`Upstream: ${config.upstream}`);
    });

    return server;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    startServer();
}
