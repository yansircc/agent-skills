/**
 * SDK message to event/envelope conversion.
 *
 * Serializes claude-agent-sdk message objects into the stream-json
 * compatible dict format used by events.jsonl and the delegate envelope.
 *
 * Uses structural typing on message objects rather than importing SDK types.
 */

interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface SdkMessage {
  type: string;
  [key: string]: unknown;
}

function contentBlocksToDicts(blocks: ContentBlock[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        result.push({ type: "text", text: block.text });
        break;
      case "thinking":
        result.push({ type: "thinking", thinking: block.thinking });
        break;
      case "tool_use":
        result.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        });
        break;
      case "tool_result":
        result.push({
          type: "tool_result",
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        });
        break;
      default:
        result.push({ type: block.type, raw: String(block) });
        break;
    }
  }
  return result;
}

export function messageToEvent(
  msg: SdkMessage,
): Record<string, unknown> | null {
  switch (msg.type) {
    case "system": {
      const event: Record<string, unknown> = {
        type: "system",
        subtype: msg.subtype,
      };
      if (msg.data && typeof msg.data === "object") {
        Object.assign(event, msg.data);
      }
      return event;
    }

    case "assistant": {
      const message = msg.message as Record<string, unknown>;
      return {
        type: "assistant",
        message: {
          model: message.model ?? msg.model,
          content: contentBlocksToDicts(
            (message.content ?? msg.content) as ContentBlock[],
          ),
        },
      };
    }

    case "user": {
      const content = msg.content;
      let contentDicts: Record<string, unknown>[];
      if (typeof content === "string") {
        contentDicts = [{ type: "text", text: content }];
      } else if (Array.isArray(content)) {
        contentDicts = contentBlocksToDicts(content as ContentBlock[]);
      } else {
        contentDicts = [{ type: "text", text: String(content) }];
      }
      const event: Record<string, unknown> = {
        type: "user",
        message: { content: contentDicts },
      };
      if (msg.tool_use_result !== null && msg.tool_use_result !== undefined) {
        event.tool_use_result = msg.tool_use_result;
      }
      return event;
    }

    case "result": {
      return {
        type: "result",
        subtype: msg.subtype,
        session_id: msg.session_id,
        is_error: msg.is_error,
        duration_ms: msg.duration_ms,
        duration_api_ms: msg.duration_api_ms,
        num_turns: msg.num_turns,
        total_cost_usd: msg.total_cost_usd,
        model_usage: msg.usage,
        result: msg.result,
        stop_reason: msg.stop_reason,
        structured_output: msg.structured_output,
      };
    }

    case "stream_event": {
      return {
        type: "stream_event",
        uuid: msg.uuid,
        session_id: msg.session_id,
        event: msg.event,
      };
    }

    default:
      return null;
  }
}

export function resultToEnvelopeFields(
  result: SdkMessage,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    session_id: result.session_id,
    duration_ms: result.duration_ms,
    model_usage: result.usage,
    num_turns: result.num_turns,
    stop_reason: result.stop_reason,
    total_cost_usd: result.total_cost_usd,
    result: result.result,
    structured_output: result.structured_output,
  };
  if (result.is_error) {
    fields.ok = false;
    fields.error_type = "delegate_error";
    fields.error_message =
      (result.result as string) || "delegate reported is_error=true";
  } else {
    fields.ok = true;
  }
  return fields;
}

export function extractToolUsesFromMessages(
  messages: SdkMessage[],
): Record<string, unknown>[] {
  const toolUses: Record<string, unknown>[] = [];
  for (const msg of messages) {
    if (msg.type !== "assistant") continue;
    const message = (msg.message ?? msg) as Record<string, unknown>;
    const content = (message.content ?? []) as ContentBlock[];
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use") {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }
  }
  return toolUses;
}
