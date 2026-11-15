
import http from "node:http";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8787;
const UPSTREAM = "https://agentrouter.org";
const API_KEY = process.env.AGENTROUTER_API_KEY;
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 300000;

if (!API_KEY) {
  console.error("Missing AGENTROUTER_API_KEY environment variable.");
  process.exit(1);
}

function isResourceMismatch(errorText) {
  const text = errorText.toLowerCase();

  return (
    (
      text.includes("different") &&
      text.includes("resource") &&
      (
        text.includes("created under") ||
        text.includes("same resource")
      )
    ) ||
    text.includes("different azure")
  );
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();

  if (!req.url?.startsWith("/v1/")) {
    res.writeHead(404);
    return res.end("Not found");
  }

  const chunks = [];

  try {
    for await (const chunk of req) {
      chunks.push(chunk);
    }
  } catch (error) {
    console.error(`[Proxy] Request body error: ${error.message}`);
    if (!res.destroyed) res.destroy();
    return;
  }

  const body = Buffer.concat(chunks);
  const clientUserAgent = req.headers["user-agent"];

  if (
    typeof clientUserAgent !== "string" ||
    !clientUserAgent.toLowerCase().startsWith("opencode/")
  ) {
    console.error(
      `[Proxy] Unsupported User-Agent: ${clientUserAgent || "missing"}`
    );

    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      error: "Missing or unsupported OpenCode User-Agent"
    }));
  }

  const headers = {
    authorization: `Bearer ${API_KEY}`,
    "content-type": req.headers["content-type"] || "application/json",
    "user-agent": clientUserAgent,
    "x-client-request-id":
    req.headers["x-client-request-id"] || randomUUID()
  };

  if (req.headers.accept) {
    headers.accept = req.headers.accept;
  }

  const url = `${UPSTREAM}${req.url}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (res.destroyed) return;

      console.log(
        `[Proxy] ${req.method} ${req.url} | Attempt ${attempt}/${MAX_ATTEMPTS}`
      );

      const upstream = await fetch(url, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
                                   signal: AbortSignal.timeout(TIMEOUT_MS)
      });

      const requestId =
      upstream.headers.get("x-request-id") ||
      upstream.headers.get("request-id") ||
      "unknown";

      if (!upstream.ok) {
        const errorText = await upstream.text();

        console.error(
          `[Upstream Error] HTTP ${upstream.status} | Request ID: ${requestId}`
        );
        console.error(errorText);

        if (
          upstream.status === 400 &&
          isResourceMismatch(errorText) &&
          attempt < MAX_ATTEMPTS
        ) {
          console.log(
            `[Proxy] Resource mismatch detected. Retrying attempt ${attempt + 1}/${MAX_ATTEMPTS}`
          );

          await sleep(attempt * 700);
          continue;
        }

        console.log(
          `[Proxy] Returning HTTP ${upstream.status} to OpenCode`
        );

        res.writeHead(upstream.status, {
          "content-type":
          upstream.headers.get("content-type") || "application/json",
                      "x-proxy-request-id": requestId
        });

        return res.end(errorText);
      }

      res.writeHead(upstream.status, {
        "content-type":
        upstream.headers.get("content-type") || "application/json",
                    "cache-control": "no-cache",
                    "x-proxy-request-id": requestId
      });

      if (upstream.body) {
        for await (const chunk of upstream.body) {
          if (res.destroyed) return;

          if (!res.write(chunk)) {
            await new Promise(resolve => {
              res.once("drain", resolve);
            });
          }
        }
      }

      const elapsed = Date.now() - startedAt;

      console.log(
        `[Proxy] Response completed | HTTP ${upstream.status} | Request ID: ${requestId} | Attempt: ${attempt} | ${elapsed}ms`
      );

      return res.end();

    } catch (error) {
      const elapsed = Date.now() - startedAt;

      console.error(
        `[Proxy Error] Attempt ${attempt}/${MAX_ATTEMPTS} | ${error.message}`
      );

      // Never retry after response headers or stream data have started.
      if (res.headersSent || res.destroyed) {
        console.error(
          "[Proxy] Streaming failed after response started. Retry disabled."
        );

        if (!res.destroyed) res.destroy();
        return;
      }

      if (attempt === MAX_ATTEMPTS) {
        console.error(
          `[Proxy] All attempts failed | ${elapsed}ms`
        );

        res.writeHead(502, {
          "content-type": "application/json"
        });

        return res.end(JSON.stringify({
          error: "Local proxy could not reach AgentRouter",
          message: error.message
        }));
      }

      console.log(
        `[Proxy] Retrying after request failure | Attempt ${attempt + 1}/${MAX_ATTEMPTS}`
      );

      await sleep(attempt * 700);
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `AgentRouter Proxy V2 running at http://127.0.0.1:${PORT}/v1`
  );
});
