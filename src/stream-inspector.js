
/**
 * AgentRouter Proxy V3
 * SSE Stream Inspector
 */

export function parseSSEEvent(rawEvent) {
    const lines = rawEvent.split(/\r?\n/);

    let event = "message";
    const dataLines = [];

    for (const line of lines) {
        if (!line || line.startsWith(":")) continue;

        const separator = line.indexOf(":");
        const field = separator === -1
        ? line
        : line.slice(0, separator);

        let value = separator === -1
        ? ""
        : line.slice(separator + 1);

        if (value.startsWith(" ")) {
            value = value.slice(1);
        }

        if (field === "event") {
            event = value;
        }

        if (field === "data") {
            dataLines.push(value);
        }
    }

    const data = dataLines.join("\n");

    let parsedData = data;

    if (data && data !== "[DONE]") {
        try {
            parsedData = JSON.parse(data);
        } catch {
            // Keep non-JSON SSE data as text.
        }
    }

    return {
        event,
        data: parsedData,
        rawData: data
    };
}

export function inspectSSEEvent(parsedEvent) {
    const { event, data } = parsedEvent;

    if (data === "[DONE]") {
        return {
            type: "done",
            responseStarted: true,
            error: null
        };
    }

    const eventType =
    typeof data === "object" && data !== null
    ? data.type || event
    : event;

    const isError =
    eventType === "error" ||
    eventType === "response.failed" ||
    eventType === "response.incomplete";

    if (isError) {
        const message =
        data?.error?.message ||
        data?.message ||
        data?.error ||
        "Unknown stream error";

    return {
        type: "error",
        responseStarted: true,
        error: {
            category: "stream_error",
            message: typeof message === "string"
            ? message
            : JSON.stringify(message)
        }
    };
    }

    return {
        type: "data",
        responseStarted: true,
        error: null
    };
}

export class StreamInspector {
    constructor() {
        this.responseStarted = false;
        this.finished = false;
        this.error = null;
        this.buffer = "";
        this.decoder = new TextDecoder("utf-8");
    }
    push(chunk) {
        if (this.finished) {
            return [];
        }

        if (typeof chunk === "string") {
            // Flush any pending UTF-8 bytes before processing a string.
            this.buffer += this.decoder.decode();
            this.buffer += chunk;
        } else {
            this.buffer += this.decoder.decode(chunk, {
                stream: true
            });
        }

        const events = [];

        while (true) {
            const match = /\r?\n\r?\n/.exec(this.buffer);

            if (!match) break;

            const rawEvent = this.buffer.slice(0, match.index);
            this.buffer = this.buffer.slice(
                match.index + match[0].length
            );

            if (!rawEvent.trim()) continue;

            const parsed = parseSSEEvent(rawEvent);
            const inspected = inspectSSEEvent(parsed);

            this.responseStarted = inspected.responseStarted;

            if (inspected.type === "error") {
                this.error = inspected.error;
            }

            if (inspected.type === "done") {
                this.finished = true;
            }

            events.push({
                parsed,
                ...inspected
            });
        }

        return events;
    }

    finish() {
        this.buffer += this.decoder.decode();
        if (this.buffer.trim() && !this.finished) {
            const parsed = parseSSEEvent(this.buffer);
            const inspected = inspectSSEEvent(parsed);

            this.responseStarted = inspected.responseStarted;

            if (inspected.type === "error") {
                this.error = inspected.error;
            }

            if (inspected.type === "done") {
                this.finished = true;
            }

            this.buffer = "";

            return [{
                parsed,
                ...inspected
            }];
        }

        this.buffer = "";
        return [];
    }

    hasStarted() {
        return this.responseStarted;
    }

    hasError() {
        return this.error !== null;
    }

    getError() {
        return this.error;
    }

    isFinished() {
        return this.finished;
    }
}
