const OpenAI = require("openai");
const Provider = require("./ai-provider.js");
const InheritMultiple = require("./helpers/classes.js");
const UnTooled = require("./helpers/untooled.js");
const { tooledStream, tooledComplete } = require("./helpers/tooled.js");
const { RetryError } = require("../error.js");
const { v4 } = require("uuid");
const { toValidNumber, safeJsonParse } = require("../../../http/index.js");
const { getAnythingLLMUserAgent } = require("../../../../endpoints/utils");
const { GenericOpenAiLLM } = require("../../../AiProviders/genericOpenAi");
const {
  RESPONSES_MODE,
  agentMessagesToResponsesInput,
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
    // Responses API continuation state. Scoped to the active agent run:
    // a fresh provider instance is built per reply(), and AIbitat only ever
    // appends to the message history within a run, so a stored response id is
    // only reused when the new input extends the previously sent input.
    this._previousResponseId = null;
    this._previousResponsesInput = [];
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
    this._previousResponseId = null;
    this._previousResponsesInput = [];
    return Provider.prototype.resetCumulativeUsage.call(this);
  }

  /**
   * Returns the stored response id for stateful Responses continuation when
   * the new input extends the previously sent input (same active run).
   * Otherwise drops the stale state so ids never leak between unrelated
   * conversations, even if an instance is ever reused.
   * @param {Array<object>} input - The Responses input about to be sent.
   * @returns {string|null}
   */
  #responsesContinuation(input = []) {
    if (
      this._previousResponseId &&
      this._previousResponsesInput.length > 0 &&
      input.length > this._previousResponsesInput.length &&
      this._previousResponsesInput.every(
        (item, index) => JSON.stringify(item) === JSON.stringify(input[index])
      )
    )
      return this._previousResponseId;
    this._previousResponseId = null;
    this._previousResponsesInput = [];
    return null;
  }

  #rememberResponsesContinuation(input = [], responseId = null) {
    this._previousResponsesInput = input;
    this._previousResponseId = responseId ?? null;
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
    if (process.env.GENERIC_OPENAI_STREAMING_DISABLED === "true") return false;
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
   * Converts aibitat messages to Responses input. Function results that lost
   * their original call metadata cannot be mapped (the API requires a call
   * id), so they are skipped with a log instead of failing the whole turn.
   */
  #formatToResponsesInput(messages) {
    return agentMessagesToResponsesInput(messages, {
      onSkipFunctionMessage: (message) =>
        this.providerLog(
          "[GenericOpenAi.#formatToResponsesInput]: message did not pass back the originalFunctionCall. We need this to map the function call to the correct id.",
          { message: JSON.stringify(message, null, 2) }
        ),
    });
  }

  /**
   * Issues a Responses request, chaining `previous_response_id` when this is
   * a continuation of the active run. If the provider rejects the
   * continuation params, retries once stateless so Responses mode still
   * works against providers without server-side chaining support.
   */
  async #createResponsesResponse(request) {
    try {
      return await this.client.responses.create(request);
    } catch (error) {
      if (request.previous_response_id && isContinuationRejectedError(error)) {
        this.providerLog(
          "Responses continuation was rejected by the provider - retrying stateless."
        );
        this._previousResponseId = null;
        this._previousResponsesInput = [];
        const { previous_response_id: _, ...statelessRequest } = request;
        return await this.client.responses.create(statelessRequest);
      }
      throw error;
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
   * loop is reused unchanged.
   */
  async #responsesComplete(messages, functions = []) {
    this.resetUsage();
    const input = this.#formatToResponsesInput(messages);
    const request = buildResponsesRequest({
      model: this.model,
      input,
      tools: formatToolsForResponses(functions),
      previousResponseId: this.#responsesContinuation(input),
    });

    let response;
    try {
      response = await this.#createResponsesResponse(request);
    } catch (error) {
      this.#throwMappedResponsesError(error);
    }

    if (response?.usage) this.recordUsage(response.usage);
    this.#rememberResponsesContinuation(input, response?.id);

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

    this._previousResponseId = null;
    this._previousResponsesInput = [];
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
    const input = this.#formatToResponsesInput(messages);
    const request = buildResponsesRequest({
      model: this.model,
      input,
      stream: true,
      tools: formatToolsForResponses(functions),
      previousResponseId: this.#responsesContinuation(input),
    });

    let response;
    try {
      response = await this.#createResponsesResponse(request);
    } catch (error) {
      this.#throwMappedResponsesError(error);
    }

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
        this.#rememberResponsesContinuation(input, event.response?.id);
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

    this._previousResponseId = null;
    this._previousResponsesInput = [];
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
