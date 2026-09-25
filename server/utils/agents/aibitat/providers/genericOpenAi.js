const OpenAI = require("openai");
const Provider = require("./ai-provider.js");
const InheritMultiple = require("./helpers/classes.js");
const UnTooled = require("./helpers/untooled.js");
const { tooledStream, tooledComplete } = require("./helpers/tooled.js");
const { RetryError } = require("../error.js");
const { v4 } = require("uuid");
const { toValidNumber, safeJsonParse } = require("../../../http/index.js");
const {
  parseBooleanEnv,
} = require("../../../helpers/parseBooleanEnv");
const { getAnythingLLMUserAgent } = require("../../../../endpoints/utils");
const { GenericOpenAiLLM } = require("../../../AiProviders/genericOpenAi");
const {
  RESPONSES_MODE,
  agentMessagesToResponsesInput,
  agentMessagesToResponsesContinuationInput,
  formatToolsForResponses,
  buildResponsesRequest,
  extractResponsesText,
  extractResponsesReasoning,
  extractResponsesToolCalls,
  isContinuationRejectedError,
} = require("../../../AiProviders/genericOpenAi/responses.js");
const { attachmentToContentBlock } = require("../../../helpers/attachments");

/**
 * The agent provider for the Generic OpenAI provider.
 * Uses native OpenAI-compatible tool calling by default and falls back to
 * the UnTooled prompt-based approach when native tool calling is disabled
 * via PROVIDER_DISABLE_NATIVE_TOOL_CALLING.
 */
class GenericOpenAiProvider extends InheritMultiple([Provider, UnTooled]) {
  model;

  constructor(config = {}) {
    super();
    this.providerTag = "generic-openai";
    const { model = "gpt-4.1-nano" } = config;
    const client = new OpenAI({
      baseURL: process.env.GENERIC_OPEN_AI_BASE_PATH,
      apiKey: process.env.GENERIC_OPEN_AI_API_KEY ?? null,
      defaultHeaders: {
        "User-Agent": getAnythingLLMUserAgent(),
        ...GenericOpenAiLLM.parseCustomHeaders(),
      },
    });

    this._client = client;
    this.model = model;
    this.verbose = true;
    this._supportsToolCalling = null;
    this.maxTokens = process.env.GENERIC_OPEN_AI_MAX_TOKENS
      ? toValidNumber(process.env.GENERIC_OPEN_AI_MAX_TOKENS, 1024)
      : 1024;
    // Responses API continuation state, scoped strictly to the active agent
    // run: { previousResponseId, previousMessageCount }. A fresh provider
    // instance is built per AIbitat reply(), AIbitat only ever appends to the
    // message history within a run, and the run is cleared on final answers,
    // run resets, and fallbacks - so message-count growth on an instance
    // reliably means "same run, new turn". Retries with identical messages go
    // stateless with full input, which is always the safe direction.
    // _responsesChainingUnsupported latches when the provider rejects
    // previous_response_id so later turns go stateless directly.
    this._responsesRun = null;
    this._responsesChainingUnsupported = false;
  }

  get client() {
    return this._client;
  }

  /**
   * The protocol mode selected via GENERIC_OPEN_AI_API_MODE. Shares the
   * single source of truth with the chat connector.
   * @returns {"chat-completions"|"responses"}
   */
  apiMode() {
    return GenericOpenAiLLM.resolveApiMode();
  }

  /**
   * Resets the run-level usage accumulator and drops any Responses
   * continuation state so the next run starts unchained. AIbitat calls this
   * at the start of every execution (depth 0).
   */
  resetCumulativeUsage() {
    this.#clearResponsesRun();
    return Provider.prototype.resetCumulativeUsage.call(this);
  }

  #clearResponsesRun() {
    this._responsesRun = null;
    this._responsesChainingUnsupported = false;
  }

  /**
   * Records a successful Responses turn as the chain head for the active run.
   * A missing response id cannot be chained, so it clears the run instead.
   */
  #setResponsesRun(messages = [], responseId = null) {
    if (!responseId) {
      this._responsesRun = null;
      return;
    }
    this._responsesRun = {
      previousResponseId: responseId,
      previousMessageCount: messages.length,
    };
  }

  /**
   * Returns the stateful continuation for these messages when the history
   * grew since the last successful turn of this run: the stored response id
   * plus only the newly appended messages. Returns null for first turns and
   * identical-message retries (which go stateless with full input), so a
   * stored id can never leak into an unrelated request.
   * @param {Array<object>} messages - The full current aibitat history.
   * @returns {{previousResponseId: string, deltaMessages: Array<object>}|null}
   */
  #responsesRunContinuation(messages = []) {
    if (this._responsesChainingUnsupported) return null;
    const run = this._responsesRun;
    if (!run?.previousResponseId) return null;
    if (messages.length <= run.previousMessageCount) return null;
    return {
      previousResponseId: run.previousResponseId,
      deltaMessages: messages.slice(run.previousMessageCount),
    };
  }

  /**
   * Generic OpenAI backends follow the OpenAI multimodal schema, so audio
   * attachments must be sent as `input_audio` blocks rather than `image_url`.
   * Mirrors the audio handling in the GenericOpenAi chat provider; images and
   * all other attachments keep the inherited `image_url` behavior.
   * @param {Object} message - The message to format
   * @returns {Object} - Message formatted for the API
   */
  formatMessageWithAttachments(message) {
    if (!message.attachments || message.attachments.length === 0)
      return message;

    const content = [{ type: "text", text: message.content }];
    for (const attachment of message.attachments) {
      content.push(attachmentToContentBlock(attachment));
    }

    const { attachments: _, ...rest } = message;
    return { ...rest, content };
  }

  get supportsAgentStreaming() {
    // Honor streaming being disabled via ENV via user preference.
    // KeplerLLM fork: strict boolean parsing. Only "true"/"1" disable streaming.
    if (parseBooleanEnv(process.env.GENERIC_OPENAI_STREAMING_DISABLED))
      return false;
    return true;
  }

  async #handleFunctionCallChat({ messages = [] }) {
    return await this.client.chat.completions
      .create({
        model: this.model,
        temperature: 0,
        messages,
        max_tokens: this.maxTokens,
      })
      .then((result) => {
        if (!result.hasOwnProperty("choices"))
          throw new Error("Generic OpenAI chat: No results!");
        if (result.choices.length === 0)
          throw new Error("Generic OpenAI chat: No results length!");
        return result.choices[0].message.content;
      })
      .catch((_) => {
        return null;
      });
  }

  async #handleFunctionCallStream({ messages = [] }) {
    return await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      messages,
    });
  }

  /**
   * Converts aibitat messages to full Responses input (stateless
   * reconstruction). Function results that lost their original call metadata
   * cannot be mapped (the API requires a call id), so they are skipped with
   * a log instead of failing the whole turn.
   */
  #formatToResponsesInput(messages) {
    return agentMessagesToResponsesInput(messages, {
      onSkipFunctionMessage: (message) =>
        this.#logSkippedFunctionMessage(message),
    });
  }

  /**
   * Converts only newly appended messages to Responses continuation input.
   * A completed function result contributes just its function_call_output -
   * the function_call already lives in the chained previous response.
   */
  #formatToResponsesContinuationInput(deltaMessages) {
    return agentMessagesToResponsesContinuationInput(deltaMessages, {
      onSkipFunctionMessage: (message) =>
        this.#logSkippedFunctionMessage(message),
    });
  }

  #logSkippedFunctionMessage(message) {
    this.providerLog(
      "[GenericOpenAi.#formatToResponsesInput]: message did not pass back the originalFunctionCall. We need this to map the function call to the correct id.",
      { message: JSON.stringify(message, null, 2) }
    );
  }

  /**
   * Builds the stateful (previous_response_id + delta-only input) and
   * stateless (full reconstructed input) Responses requests for one turn.
   * `store` is intentionally omitted on both so the provider default applies:
   * forcing `store: false` would defeat server-side chaining, which is the
   * point of Responses mode for agentic runs.
   */
  #buildResponsesTurnRequests(messages, functions, continuation) {
    const tools = formatToolsForResponses(functions);
    const statelessRequest = buildResponsesRequest({
      model: this.model,
      input: this.#formatToResponsesInput(messages),
      maxOutputTokens: this.maxTokens,
      stream: false,
      tools,
    });
    if (!continuation) return { statefulRequest: null, statelessRequest };
    return {
      statefulRequest: buildResponsesRequest({
        model: this.model,
        input: this.#formatToResponsesContinuationInput(
          continuation.deltaMessages
        ),
        maxOutputTokens: this.maxTokens,
        stream: false,
        tools,
        previousResponseId: continuation.previousResponseId,
      }),
      statelessRequest,
    };
  }

  /**
   * Issues a Responses turn request, chaining `previous_response_id` with
   * delta-only input when this is a continuation of the active run. If the
   * provider rejects the continuation params, retries once with the full
   * stateless reconstruction (a delta-only payload alone would be an
   * independently-invalid request) and latches chaining off for the run.
   * @returns {Promise<{response: object, stateful: boolean}>}
   */
  async #createResponsesResponse(statefulRequest, statelessRequest) {
    if (!statefulRequest)
      return {
        response: await this.client.responses.create(statelessRequest),
        stateful: false,
      };
    try {
      return {
        response: await this.client.responses.create(statefulRequest),
        stateful: true,
      };
    } catch (error) {
      if (!isContinuationRejectedError(error)) throw error;
      this.providerLog(
        "Responses continuation was rejected by the provider - retrying with full reconstructed input. Reasoning continuity was not preserved for this turn."
      );
      this._responsesRun = null;
      this._responsesChainingUnsupported = true;
      return {
        response: await this.client.responses.create(statelessRequest),
        stateful: false,
      };
    }
  }

  /**
   * Maps an OpenAI SDK error to the agent retry semantics used by the
   * chat-completions path.
   */
  #throwMappedResponsesError(error) {
    if (error instanceof OpenAI.AuthenticationError) throw error;
    if (
      error instanceof OpenAI.RateLimitError ||
      error instanceof OpenAI.InternalServerError ||
      error instanceof OpenAI.APIError
    ) {
      throw new RetryError(error.message);
    }
    throw error;
  }

  /**
   * Non-streaming completion via the Responses API. Tool calls are normalized
   * to the {id, name, arguments} shape AIbitat already expects, so the agent
   * loop is reused unchanged. AIbitat consumes one function call per model
   * turn (matching `parallel_tool_calls: false`); sequential turns chain via
   * the run-scoped continuation state.
   */
  async #responsesComplete(messages, functions = []) {
    this.resetUsage();
    const continuation = this.#responsesRunContinuation(messages);
    const { statefulRequest, statelessRequest } =
      this.#buildResponsesTurnRequests(messages, functions, continuation);

    let outcome;
    try {
      outcome = await this.#createResponsesResponse(
        statefulRequest,
        statelessRequest
      );
    } catch (error) {
      this.#throwMappedResponsesError(error);
    }
    const response = outcome.response;

    if (response?.usage) this.recordUsage(response.usage);
    this.#setResponsesRun(messages, response?.id);

    const toolCalls = extractResponsesToolCalls(response);
    if (toolCalls.length > 0) {
      const toolCall = toolCalls[0];
      const functionArgs = safeJsonParse(toolCall.arguments, null);
      if (functionArgs === null) {
        return {
          textResponse: null,
          retryWithError: {
            role: "function",
            name: toolCall.name,
            content: `Failed to parse tool call arguments as JSON. Raw arguments: ${toolCall.arguments}`,
            originalFunctionCall: {
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
          cost: this.getCost(),
          usage: this.getUsage(),
        };
      }
      return {
        textResponse: null,
        functionCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: functionArgs,
        },
        cost: this.getCost(),
        usage: this.getUsage(),
      };
    }

    this._responsesRun = null;
    const reasoning = extractResponsesReasoning(response);
    let textResponse = extractResponsesText(response);
    if (reasoning && reasoning.trim().length > 0)
      textResponse = `<think>${reasoning}</think>${textResponse}`;
    return {
      textResponse,
      functionCall: null,
      cost: this.getCost(),
      usage: this.getUsage(),
    };
  }

  /**
   * Streaming completion via the Responses API. Responses streaming events
   * are translated to the same reportStreamEvent contract the
   * chat-completions path emits (textResponseChunk / toolCallInvocation).
   */
  async #responsesStream(messages, functions = [], eventHandler = null) {
    this.resetUsage();
    const msgUUID = v4();
    const continuation = this.#responsesRunContinuation(messages);
    const { statefulRequest, statelessRequest } =
      this.#buildResponsesTurnRequests(messages, functions, continuation);
    // Streaming uses the same turn requests with the stream flag enabled.
    if (statefulRequest) statefulRequest.stream = true;
    statelessRequest.stream = true;

    let outcome;
    try {
      outcome = await this.#createResponsesResponse(
        statefulRequest,
        statelessRequest
      );
    } catch (error) {
      this.#throwMappedResponsesError(error);
    }
    const response = outcome.response;

    const completion = { content: "", functionCall: null };
    let reasoningText = "";

    const reportToolCall = () => {
      eventHandler?.("reportStreamEvent", {
        type: "toolCallInvocation",
        uuid: `${msgUUID}:tool_call_invocation`,
        content: `Assembling Tool Call: ${completion.functionCall.name}(${completion.functionCall.arguments})`,
      });
    };

    for await (const event of response) {
      const type = event?.type ?? "";

      if (type === "response.output_text.delta" && event.delta) {
        completion.content += event.delta;
        eventHandler?.("reportStreamEvent", {
          type: "textResponseChunk",
          uuid: msgUUID,
          content: event.delta,
        });
        continue;
      }

      if (
        type === "response.output_item.added" &&
        event.item?.type === "function_call"
      ) {
        completion.functionCall = {
          name: event.item.name,
          call_id: event.item.call_id,
          arguments: event.item.arguments ?? "",
        };
        reportToolCall();
        continue;
      }

      if (type === "response.function_call_arguments.delta" && event.delta) {
        if (!completion.functionCall) continue;
        completion.functionCall.arguments += event.delta;
        reportToolCall();
        continue;
      }

      if (type === "response.function_call_arguments.done") {
        if (completion.functionCall && typeof event.arguments === "string")
          completion.functionCall.arguments = event.arguments;
        continue;
      }

      if (
        typeof event?.delta === "string" &&
        event.delta.length > 0 &&
        /reasoning/i.test(type)
      ) {
        eventHandler?.("reportStreamEvent", {
          type: "textResponseChunk",
          uuid: msgUUID,
          content:
            reasoningText.length === 0 ? `<think>${event.delta}` : event.delta,
        });
        reasoningText += event.delta;
        continue;
      }

      if (type === "response.completed") {
        if (event.response?.usage) this.recordUsage(event.response.usage);
        this.#setResponsesRun(messages, event.response?.id);
        continue;
      }

      if (type === "response.failed") {
        throw new Error(
          event?.response?.error?.message || "The Responses API request failed."
        );
      }

      if (type === "error") {
        throw new Error(event?.message || "The Responses API request failed.");
      }
    }

    if (completion.functionCall) {
      const functionArgs = safeJsonParse(
        completion.functionCall.arguments,
        null
      );
      if (functionArgs === null) {
        return {
          textResponse: null,
          retryWithError: {
            role: "function",
            name: completion.functionCall.name,
            content: `Failed to parse tool call arguments as JSON. Raw arguments: ${completion.functionCall.arguments}`,
            originalFunctionCall: {
              id: completion.functionCall.call_id,
              name: completion.functionCall.name,
              arguments: completion.functionCall.arguments,
            },
          },
          uuid: msgUUID,
          usage: this.getUsage(),
        };
      }
      return {
        textResponse: completion.content,
        functionCall: {
          id: completion.functionCall.call_id,
          name: completion.functionCall.name,
          arguments: functionArgs,
        },
        uuid: msgUUID,
        usage: this.getUsage(),
      };
    }

    this._responsesRun = null;
    let textResponse = completion.content;
    if (reasoningText.trim().length > 0)
      textResponse = `<think>${reasoningText}</think>${textResponse}`;
    return {
      textResponse,
      functionCall: null,
      uuid: msgUUID,
      usage: this.getUsage(),
    };
  }

  /**
   * Stream a chat completion with tool calling support.
   * Uses native tool calling when supported, otherwise falls back to UnTooled.
   */
  async stream(messages, functions = [], eventHandler = null) {
    const useNative = await this.supportsNativeToolCalling();

    if (!useNative) {
      return await UnTooled.prototype.stream.call(
        this,
        messages,
        functions,
        this.#handleFunctionCallStream.bind(this),
        eventHandler
      );
    }

    this.providerLog(
      "Provider.stream (tooled) - will process this chat completion."
    );

    try {
      if (this.apiMode() === RESPONSES_MODE)
        return await this.#responsesStream(messages, functions, eventHandler);
      return await tooledStream(
        this.client,
        this.model,
        messages,
        functions,
        eventHandler,
        { provider: this }
      );
    } catch (error) {
      console.error(error.message, error);
      if (error instanceof OpenAI.AuthenticationError) throw error;
      if (
        error instanceof OpenAI.RateLimitError ||
        error instanceof OpenAI.InternalServerError ||
        error instanceof OpenAI.APIError
      ) {
        throw new RetryError(error.message);
      }
      throw error;
    }
  }

  /**
   * Create a non-streaming completion with tool calling support.
   * Uses native tool calling when supported, otherwise falls back to UnTooled.
   */
  async complete(messages, functions = []) {
    const useNative = await this.supportsNativeToolCalling();

    if (!useNative) {
      return await UnTooled.prototype.complete.call(
        this,
        messages,
        functions,
        this.#handleFunctionCallChat.bind(this)
      );
    }

    try {
      if (this.apiMode() === RESPONSES_MODE) {
        const result = await this.#responsesComplete(messages, functions);

        if (result.retryWithError) {
          return this.complete([...messages, result.retryWithError], functions);
        }

        return result;
      }

      const result = await tooledComplete(
        this.client,
        this.model,
        messages,
        functions,
        this.getCost.bind(this),
        { provider: this }
      );

      if (result.retryWithError) {
        return this.complete([...messages, result.retryWithError], functions);
      }

      return result;
    } catch (error) {
      if (error instanceof OpenAI.AuthenticationError) throw error;
      if (
        error instanceof OpenAI.RateLimitError ||
        error instanceof OpenAI.InternalServerError ||
        error instanceof OpenAI.APIError
      ) {
        throw new RetryError(error.message);
      }
      throw error;
    }
  }

  /**
   * Get the cost of the completion.
   *
   * @param _usage The completion to get the cost for.
   * @returns The cost of the completion.
   */
  getCost(_usage) {
    return 0;
  }
}

module.exports = GenericOpenAiProvider;
