
/**
 * AgentRouter Proxy V3
 * Responses API Sanitizer
 *
 * Inspired by the sanitization strategy in:
 * https://github.com/madgagarin/pi-agentrouter
 *
 * This implementation is independently designed for our proxy.
 */

/**
 * Checks whether a value is a non-null object.
 */
function isRecord(value) {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

/**
 * Identifies reasoning items tied to a backend resource.
 */
function isIncompatibleReasoningItem(item) {
    return (
        item.type === "reasoning" ||
        Object.hasOwn(item, "encrypted_content") ||
        (
            typeof item.id === "string" &&
            item.id.startsWith("rs_")
        )
    );
}

/**
 * Sanitizes nested content blocks.
 */
function sanitizeContent(content) {
    if (!Array.isArray(content)) return content;

    return content.filter((block) => {
        if (!isRecord(block)) return true;

        if (isIncompatibleReasoningItem(block)) {
            return false;
        }

        return true;
    }).map((block) => {
        if (!isRecord(block)) return block;

        const sanitizedBlock = { ...block };

        delete sanitizedBlock.id;

        return sanitizedBlock;
    });
}

/**
 * Sanitizes Responses API input items.
 *
 * The original input is never modified.
 */
export function sanitizeResponsesInput(input) {
    if (!Array.isArray(input)) {
        throw new TypeError("Responses input must be an array.");
    }

    const sanitized = [];

    for (const item of input) {
        if (!isRecord(item)) {
            sanitized.push(item);
            continue;
        }

        if (isIncompatibleReasoningItem(item)) {
            continue;
        }

        if (
            item.type === "message" &&
            item.role === "assistant" &&
            item.status === "error"
        ) {
            continue;
        }

        const sanitizedItem = { ...item };

        // Backend-specific item IDs are not portable.
        delete sanitizedItem.id;

        if (Array.isArray(item.content)) {
            sanitizedItem.content = sanitizeContent(item.content);
        }

        sanitized.push(sanitizedItem);
    }

    return sanitized;
}

/**
 * Sanitizes a complete Responses API request body.
 *
 * Call this only when recovery from a cross-resource
 * error is necessary, not on every normal request.
 */
export function sanitizeResponsesPayload(payload) {
    if (!isRecord(payload)) {
        throw new TypeError("Responses payload must be an object.");
    }

    const sanitized = structuredClone(payload);

    if (Array.isArray(sanitized.input)) {
        sanitized.input = sanitizeResponsesInput(sanitized.input);
    }

    // Previous response IDs may belong to another backend resource.
    delete sanitized.previous_response_id;

    return sanitized;
}
