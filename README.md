# AgentRouter Proxy V3

A lightweight local HTTP proxy for AgentRouter, designed to improve reliability when using the OpenAI Responses API through OpenCode.

AgentRouter Proxy V3 provides targeted error recovery, request sanitization, retry handling, and Server-Sent Events (SSE) inspection.

## Overview

Some Responses API requests may fail when response items are associated with a different OpenAI resource than the one handling the current request.

AgentRouter Proxy V3 introduces a targeted recovery mechanism for this specific resource mismatch error.

Instead of modifying every request, the proxy detects the relevant upstream error and sanitizes the affected request before retrying it.

## Features

- **Targeted Error Recovery:** Detects specific cross-resource mismatch errors.
- **Responses API Sanitization:** Removes incompatible response state and non-portable identifiers when recovery is required.
- **Retry Management:** Uses controlled retry decisions and exponential backoff.
- **SSE Stream Inspection:** Inspects streaming events and handles stream-related errors.
- **Session Management:** Tracks response state and invalidates affected session references.
- **Request Validation:** Validates incoming requests and upstream destinations.
- **Security Controls:** Applies header allowlisting, request size limits, and API key protection.
- **Lightweight:** Built with Node.js native modules.

## Requirements

- Node.js 22 or later
- npm
- An AgentRouter API key
- OpenCode or a compatible client using the supported request format

## Installation

Clone the repository:

```bash
git clone https://github.com/R4G-1/AgentRouter-Proxy-V3.git
cd AgentRouter-Proxy-V3
```

Install dependencies:

```bash
npm install
```

## Configuration

The proxy requires an AgentRouter API key.

Set the environment variable before starting the server.

### Linux / macOS (Bash)

```bash
export AGENTROUTER_API_KEY="YOUR_API_KEY"
```

### Linux (Fish)

```fish
set -gx AGENTROUTER_API_KEY "YOUR_API_KEY"
```

Never commit your API key or place it in a public configuration file.

The default upstream is:

```text
https://agentrouter.org
```

The default local server address is:

```text
http://127.0.0.1:8788
```

## Running the Proxy

Start the server:

```bash
node server-v3.mjs
```

The proxy listens locally and exposes the `/v1/` API routes.

## OpenCode Configuration

Configure your OpenCode AgentRouter provider to use the local proxy as its base URL:

```text
http://127.0.0.1:8788/v1
```

Keep your selected AgentRouter model unchanged. The proxy forwards supported requests to AgentRouter.

The proxy expects the OpenCode User-Agent format (`opencode/`).

## How Recovery Works

The recovery flow is designed to be selective:

1. A request is received by the local proxy.
2. The proxy forwards it to AgentRouter.
3. The upstream response is inspected for errors.
4. If the specific resource mismatch error is detected, the proxy sanitizes the affected Responses API payload.
5. A retry is attempted using the sanitized payload, subject to retry rules.
6. The resulting response is returned to the client.

Sanitization is not applied indiscriminately to every request.

Retries are not performed after the response has started streaming to the client.

## Testing

Run the test suite:

```bash
npm test
```

The project uses Node.js's built-in test runner.

## Project Structure

```text
AgentRouter-Proxy-V3/
├── src/
├── tests/
├── server-v3.mjs
├── package.json
├── package-lock.json
├── .gitignore
├── LICENSE
└── README.md
```

## Security Notes

- Keep your AgentRouter API key private.
- Do not expose the local proxy to public networks without appropriate security measures.
- Review configuration and access controls before changing the default host.
- Do not share logs containing private request data or credentials.

## Limitations

- Recovery is designed for a specific cross-resource mismatch error, not every possible upstream failure.
- Successful recovery depends on the request structure and the upstream service response.
- This project does not guarantee that every failed Responses API request can be recovered.

## Contributing

Bug reports, suggestions, and improvements are welcome.

Please open an issue to describe a problem or propose a change before submitting major modifications.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## Disclaimer

AgentRouter Proxy V3 is an independent community project. It is not affiliated with, endorsed by, or officially supported by AgentRouter or OpenAI.
