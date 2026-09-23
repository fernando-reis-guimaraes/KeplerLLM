/**
 * Protocol adapters between AnythingLLM/KeplerLLM chat-completions-style
 * messages and the OpenAI-compatible Responses API (`POST /responses`).
 *
 * This module is intentionally pure: it performs no I/O and does not import
 * the OpenAI SDK, so the protocol boundary can be unit tested in isolation.
 * Both the chat LLM connector (`./index.js`) and the agent provider
 * (`../../../agents/aibitat/providers/genericOpenAi.js`) build on these
 * helpers and normalize everything back to the pre-existing internal
 * contracts, so downstream code never sees Responses-specific structures.
 */

const CHAT_COMPLETIONS_MODE = "chat-completions";
const RESPONSES_MODE = "responses";
const SUPPORTED_API_MODES = [CHAT_COMPLETIONS_MODE, RESPONSES_MODE];

/**
 * Resolves the Generic OpenAI protocol mode from the environment.
 * Unset/blank -> chat-completions (backwards compatible default).
 * Invalid values log a warning and fall back to chat-completions.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {"chat-completions"|"responses"}
 */
function resolveApiMode(env = process.env) {
  const raw = env?.GENERIC_OPEN_AI_API_MODE;
  if (raw === undefined || raw === null || String(raw).trim() === "")
    return CHAT_COMPLETIONS_MODE;
  const normalized = String(raw).trim().toLowerCase();
  if (SUPPORTED_API_MODES.includes(normalized)) return normalized;
  console.warn(
    `[GenericOpenAiLLM] Invalid GENERIC_OPEN_AI_API_MODE=${JSON.stringify(
      raw
    )} - falling back to "${CHAT_COMPLETIONS_MODE}". Supported values: ${SUPPORTED_API_MODES.join(
      ", "
    )}.`
  );
  return CHAT_COMPLETIONS_MODE;
}

/**
 * Maps a single chat-completions content block to a Responses input block.
 * - {type: "text"} -> {type: "input_text"}
 * - {type: "image_url"} -> {type: "input_image"}
 * - {type: "input_audio"} -> {type: "input_audio"} (best effort; the Responses
 *   audio input shape matches the chat provider's audio block shape)
 * Unknown blocks fall back to an input_text JSON rendering so content is never
 * silently dropped.
 * @param {object} block
 * @returns {object}
 */
function chatContentBlockToResponsesBlock(block) {
  if (!block || typeof block !== "object") return block;
  if (block.type === "text" && typeof block.text === "string")
    return { type: "input_text", text: block.text };
  if (block.type === "input_text" && typeof block.text === "string")
    return { type: "input_text", text: block.text };
  if (block.type === "image_url") {
    const url = block.image_url?.url ?? block.image_url;
    if (typeof url === "string")
      return {
        type: "input_image",
        image_url: url,
        detail: block.image_url?.detail ?? "auto",
      };
  }
  if (block.type === "input_image") {
    if (typeof block.image_url === "string")
      return {
        type: "input_image",
        image_url: block.image_url,
        detail: block.detail ?? "auto",
      };
  }
  if (block.type === "input_audio") {
    const audio = block.input_audio ?? {};
    if (typeof audio.data === "string")
      return {
        type: "input_audio",
        data: audio.data,
        format: audio.format,
      };
  }
  if (typeof block.text === "string")
    return { type: "input_text", text: block.text };
  return { type: "input_text", text: JSON.stringify(block) };
}

/**
 * Converts chat content (string or block array) to Responses input content.
 * Plain strings pass through untouched since EasyInputMessage accepts them.
 * @param {string|object[]} content
 * @returns {string|object[]}
 */
function chatContentToResponsesContent(content) {
  if (typeof content === "string" || content == null) return content ?? "";
  if (Array.isArray(content))
    return content.map(chatContentBlockToResponsesBlock);
  return content;
}

/**
 * Converts an aibitat attachment ({name, mime, contentString}) to a Responses
 * input block. Mirrors the chat provider's audio-vs-image split.
 * @param {object} attachment
 * @returns {object}
 */
function attachmentToResponsesBlock(attachment = {}) {
  const contentString = attachment?.contentString ?? "";
  const isAudio =
    attachment?.mime?.startsWith("audio/") ||
    (typeof contentString === "string" &&
      contentString.startsWith("data:audio/"));
  if (isAudio) {
    const subtype = (
      attachment?.mime ||
      (typeof contentString === "string" &&
        contentString.match(/^data:([^;]+);/)?.[1]) ||
      ""
    )
      .split("/")[1]
      ?.split(";")[0]
      ?.toLowerCase();
    let format = subtype?.replace(/^x-/, "") || "";
    if (subtype === "mpeg" || subtype === "mp3") format = "mp3";
    if (subtype === "wave" || subtype === "x-wav") format = "wav";
    return {
      type: "input_audio",
      data:
        typeof contentString === "string" ? contentString.split(",").pop() : "",
      format,
    };
  }
  return {
    type: "input_image",
    image_url: contentString,
    detail: "auto",
  };
}

/**
 * Converts chat-completions messages (system/user/assistant, string or block
 * content) into a Responses `input` array. Roles and ordering are preserved;
 * EasyInputMessage natively supports the system/user/assistant roles.
 * @param {Array<{role: string, content: string|object[]}>} messages
 * @returns {Array<object>}
 */
function chatMessagesToResponsesInput(messages = []) {
  return (messages ?? []).map((message) => ({
    role: message.role,
    content: chatContentToResponsesContent(message.content),
  }));
}

/**
 * Converts aibitat agent messages into a Responses `input` array.
 * - system/user/assistant pass through (attachments expanded to input blocks).
 * - role "function" with originalFunctionCall becomes a function_call +
 *   function_call_output pair carrying the provider's call id so outputs map
 *   back to the tool call that produced them.
 * - role "function" without originalFunctionCall cannot be mapped (the
 *   Responses API requires a call id) and is skipped with a log hook.
 * @param {Array<object>} messages
 * @param {{onSkipFunctionMessage?: (message: object) => void}} [hooks]
 * @returns {Array<object>}
 */
function agentMessagesToResponsesInput(messages = [], hooks = {}) {
  const input = [];
  for (const message of messages ?? []) {
    if (message?.role === "function") {
      const call = message.originalFunctionCall;
      if (!call?.id) {
        hooks.onSkipFunctionMessage?.(message);
        continue;
      }
      const args =
        typeof call.arguments === "string"
          ? call.arguments
          : JSON.stringify(call.arguments ?? {});
      input.push(
        {
          type: "function_call",
          name: call.name,
          call_id: call.id,
          arguments: args,
        },
        {
          type: "function_call_output",
          call_id: call.id,
          output:
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content ?? ""),
        }
      );
      continue;
    }

    const attachments = Array.isArray(message?.attachments)
      ? message.attachments
      : [];
    if (attachments.length === 0) {
      input.push({
        role: message.role,
        content: chatContentToResponsesContent(message.content),
      });
      continue;
    }

    const content = [
      {
        type: "input_text",
        text:
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content ?? ""),
      },
      ...attachments.map(attachmentToResponsesBlock),
    ];
    input.push({ role: message.role, content });
  }
  return input;
}

/**
 * Formats aibitat function definitions as Responses function tools.
 * strict:false keeps generic providers from rejecting schemas they cannot
 * strictly validate.
 * @param {Array<{name: string, description: string, parameters: object}>} functions
 * @returns {Array<object>}
 */
function formatToolsForResponses(functions = []) {
  if (!Array.isArray(functions) || functions.length === 0) return [];
  return functions.map((func) => ({
    type: "function",
    name: func.name,
    description: func.description,
    parameters: func.parameters,
    strict: false,
  }));
}

/**
 * Builds Responses `create` params from normalized inputs.
 * Temperature is intentionally omitted: many Responses-only reasoning
 * deployments reject it, and the agent chat-completions path never sent it.
 * Callers that must send temperature can spread it in afterwards.
 * @param {object} options
 * @param {string} options.model
 * @param {Array<object>|string} options.input
 * @param {number} [options.maxOutputTokens]
 * @param {boolean} [options.stream=false]
 * @param {Array<object>} [options.tools=[]]
 * @param {string|null} [options.previousResponseId=null]
 * @returns {object}
 */
function buildResponsesRequest({
  model,
  input,
  maxOutputTokens,
  stream = false,
  tools = [],
  previousResponseId = null,
}) {
  return {
    model,
    input,
    stream,
    store: false,
    parallel_tool_calls: false,
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  };
}

/**
 * Extracts assistant text from a Responses response.
 * Prefers the SDK `output_text` convenience property, then walks message
 * output items. Never assumes chat-completions structures exist.
 * @param {object} response
 * @returns {string}
 */
function extractResponsesText(response) {
  if (
    typeof response?.output_text === "string" &&
    response.output_text.length > 0
  )
    return response.output_text;
  let text = "";
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string")
        text += part.text;
      else if (part?.type === "refusal" && typeof part.refusal === "string")
        text += part.refusal;
    }
  }
  return text;
}

/**
 * Extracts reasoning text from a Responses response (`reasoning` output items
 * with summary parts). Providers that surface reasoning under other keys are
 * picked up liberally; unknown shapes are ignored rather than crashing.
 * @param {object} response
 * @returns {string}
 */
function extractResponsesReasoning(response) {
  const parts = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== "reasoning") continue;
    for (const summary of item.summary ?? []) {
      if (typeof summary?.text === "string" && summary.text.length > 0)
        parts.push(summary.text);
    }
    for (const key of ["reasoning_content", "reasoning", "thinking", "text"]) {
      if (typeof item[key] === "string" && item[key].length > 0)
        parts.push(item[key]);
    }
  }
  return parts.join("\n");
}

/**
 * Extracts function calls from a Responses response output.
 * Returns every call in order; callers that only support one tool turn
 * (AIbitat) take the first.
 * @param {object} response
 * @returns {Array<{id: string, name: string, arguments: string}>}
 */
function extractResponsesToolCalls(response) {
  const calls = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== "function_call") continue;
    calls.push({
      id: item.call_id || item.id,
      name: item.name,
      arguments:
        typeof item.arguments === "string"
          ? item.arguments
          : JSON.stringify(item.arguments ?? {}),
    });
  }
  return calls;
}

/**
 * Normalizes Responses usage ({input_tokens, output_tokens, total_tokens})
 * into the internal {prompt_tokens, completion_tokens, total_tokens} shape.
 * Missing values become 0, matching the chat-completions default behavior;
 * values are never fabricated beyond that.
 * @param {object} usage
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number}}
 */
function normalizeResponsesUsage(usage = {}) {
  const toNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  };
  const prompt_tokens = toNumber(usage?.prompt_tokens ?? usage?.input_tokens);
  const completion_tokens = toNumber(
    usage?.completion_tokens ?? usage?.output_tokens
  );
  const total_tokens = toNumber(
    usage?.total_tokens ?? prompt_tokens + completion_tokens
  );
  return { prompt_tokens, completion_tokens, total_tokens };
}

/**
 * Whether a Responses SDK error looks like the provider rejecting the
 * stateful-continuation params (previous_response_id/store), in which case the
 * caller should retry once stateless.
 * @param {Error} error
 * @returns {boolean}
 */
function isContinuationRejectedError(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("previous_response_id") ||
    message.includes("previous response") ||
    (message.includes("store") &&
      (message.includes("invalid") ||
        message.includes("unsupported") ||
        message.includes("unknown") ||
        message.includes("unexpected")))
  );
}

module.exports = {
  CHAT_COMPLETIONS_MODE,
  RESPONSES_MODE,
  SUPPORTED_API_MODES,
  resolveApiMode,
  chatContentBlockToResponsesBlock,
  chatContentToResponsesContent,
  attachmentToResponsesBlock,
  chatMessagesToResponsesInput,
  agentMessagesToResponsesInput,
  formatToolsForResponses,
  buildResponsesRequest,
  extractResponsesText,
  extractResponsesReasoning,
  extractResponsesToolCalls,
  normalizeResponsesUsage,
  isContinuationRejectedError,
};
