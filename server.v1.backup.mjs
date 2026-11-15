
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8787;
const UPSTREAM = "https://agentrouter.org";
const API_KEY = process.env.AGENTROUTER_API_KEY;

if (!API_KEY) {
  console.error("Missing AGENTROUTER_API_KEY environment variable.");
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/v1/")) {
    res.writeHead(404);
    return res.end("Not found");
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

 const clientUserAgent = req.headers["user-agent"];

if (
  typeof clientUserAgent !== "string" ||
  !clientUserAgent.toLowerCase().startsWith("opencode/")
) {
  console.error(
    `[Proxy] Unsupported or missing OpenCode User-Agent: ${clientUserAgent || "missing"}`
  );

  res.writeHead(400, { "content-type": "application/json" });
  return res.end(JSON.stringify({
    error: "Missing or unsupported OpenCode User-Agent",
    received: clientUserAgent || null
  }));
}

const headers = {
  "authorization": `Bearer ${API_KEY}`,
  "content-type": req.headers["content-type"] || "application/json",
  "user-agent": clientUserAgent,
  "x-client-request-id":
    req.headers["x-client-request-id"] || crypto.randomUUID(),
};

  if (req.headers["accept"]) {
    headers.accept = req.headers["accept"];
  }

  const url = `${UPSTREAM}${req.url}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Proxy] ${req.method} ${req.url} | Attempt ${attempt}/3`);

      const upstream = await fetch(url, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
        signal: AbortSignal.timeout(300000),
      });

      const requestId =
        upstream.headers.get("x-request-id") ||
        upstream.headers.get("request-id") ||
        "unknown";

      if (!upstream.ok) {
        const errorText = await upstream.text();

        const isResourceMismatch =
          errorText.toLowerCase().includes("different azure") ||
          errorText.toLowerCase().includes("different openai resource");

        console.error(
          `[Upstream Error] HTTP ${upstream.status} | Request ID: ${requestId}`
        );
        console.error(errorText);

        if (isResourceMismatch && attempt < 3) {
          console.log("[Proxy] Resource mismatch detected. Retrying...");
          await sleep(attempt * 700);
          continue;
        }

        res.writeHead(upstream.status, {
          "content-type":
            upstream.headers.get("content-type") || "application/json",
          "x-proxy-request-id": requestId,
        });
        return res.end(errorText);
      }

      const responseHeaders = {
        "content-type":
          upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-cache",
        "x-proxy-request-id": requestId,
      };

      res.writeHead(upstream.status, responseHeaders);

      if (upstream.body) {
        for await (const chunk of upstream.body) {
          if (!res.write(chunk)) {
            await new Promise(resolve => res.once("drain", resolve));
          }
        }
      }

      return res.end();

    } catch (error) {
      console.error(`[Proxy Error] ${error.message}`);

      if (attempt === 3) {
        res.writeHead(502, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          error: "Local proxy could not reach AgentRouter",
          message: error.message
        }));
      }

      await sleep(attempt * 700);
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AgentRouter Proxy running at http://127.0.0.1:${PORT}/v1`);
});
