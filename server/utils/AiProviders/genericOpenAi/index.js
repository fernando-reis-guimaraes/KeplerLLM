const { NativeEmbedder } = require("../../EmbeddingEngines/native");
const { isAbortError } = require("../../helpers/abortSignals");
const {
  LLMPerformanceMonitor,
} = require("../../helpers/chat/LLMPerformanceMonitor");
const {
  formatChatHistory,
  writeResponseChunk,
  clientAbortedHandler,
  extractReasoningContent,
} = require("../../helpers/chat/responses");
const { v4: uuidv4 } = require("uuid");
const { toValidNumber } = require("../../http");
const { getAnythingLLMUserAgent } = require("../../../endpoints/utils");
const { attachmentToContentBlock } = require("../../helpers/attachments");
const {
  RESPONSES_MODE,
  resolveApiMode,
  chatMessagesToResponsesInput,
  buildResponsesRequest,
  extractResponsesText,
  extractResponsesReasoning,
  normalizeResponsesUsage,
} = require("./responses");

class GenericOpenAiLLM {
  constructor(embedder = null, modelPreference = null) {
    const { OpenAI: OpenAIApi } = require("openai");
    if (!process.env.GENERIC_OPEN_AI_BASE_PATH)
      throw new Error(
        "GenericOpenAI must have a valid base path to use for the api."
      );

    this.className = "GenericOpenAiLLM";
    this.basePath = process.env.GENERIC_OPEN_AI_BASE_PATH;
    this.openai = new OpenAIApi({
      baseURL: this.basePath,
      apiKey: process.env.GENERIC_OPEN_AI_API_KEY ?? null,
      defaultHeaders: {
        "User-Agent": getAnythingLLMUserAgent(),
        ...GenericOpenAiLLM.parseCustomHeaders(),
      },
    });
    this.model =
      modelPreference ?? process.env.GENERIC_OPEN_AI_MODEL_PREF ?? null;
    this.maxTokens = process.env.GENERIC_OPEN_AI_MAX_TOKENS
      ? toValidNumber(process.env.GENERIC_OPEN_AI_MAX_TOKENS, 1024)
      : 1024;
    if (!this.model)
      throw new Error("GenericOpenAI must have a valid model set.");
    this.limits = {
      history: this.promptWindowLimit() * 0.15,
      system: this.promptWindowLimit() * 0.15,
      user: this.promptWindowLimit() * 0.7,
    };

    this.embedder = embedder ?? new NativeEmbedder();
    this.defaultTemp = 0.7;
    this.log(
      `Inference API: ${this.basePath} Model: ${this.model} API mode: ${this.apiMode()}`
    );
  }

  /**
   * Resolves the protocol mode from the environment. Single source of truth
   * for both the chat connector and the agent provider.
   * @returns {"chat-completions"|"responses"}
   */
  static resolveApiMode() {
    return resolveApiMode(process.env);
  }

  /**
   * The protocol mode selected for this instance.
   * @returns {"chat-completions"|"responses"}
   */
  apiMode() {
    return this.constructor.resolveApiMode();
  }

  log(text, ...args) {
    console.log(`\x1b[36m[${this.className}]\x1b[0m ${text}`, ...args);
  }

  /**
   * Parses custom headers from a CSV-formatted environment variable.
   * Format: "Header-Name:value,Another-Header:value2"
   * @returns {Object} Object with header key-value pairs
   */
  static parseCustomHeaders() {
    const customHeadersEnv = process.env.GENERIC_OPEN_AI_CUSTOM_HEADERS;
    if (!customHeadersEnv) return {};

    const headers = {};
    const pairs = customHeadersEnv.split(",");

    for (const pair of pairs) {
      const colonIndex = pair.indexOf(":"); // only split on first colon for key/value separation
      if (colonIndex === -1) continue;

      const key = pair.substring(0, colonIndex).trim();
      const value = pair.substring(colonIndex + 1).trim();

      if (key && value) headers[key] = value;
    }

    return headers;
  }

  #appendContext(contextTexts = []) {
    if (!contextTexts || !contextTexts.length) return "";
    return (
      "\nContext:\n" +
      contextTexts
        .map((text, i) => {
          return `[CONTEXT ${i}]:\n${text}\n[END CONTEXT ${i}]\n\n`;
        })
        .join("")
    );
  }

  streamingEnabled() {
    if (process.env.GENERIC_OPENAI_STREAMING_DISABLED === "true") return false;
    return "streamGetChatCompletion" in this;
  }

  static promptWindowLimit(_modelName) {
    const limit = process.env.GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT || 4096;
    if (!limit || isNaN(Number(limit)))
      throw new Error("No token context limit was set.");
    return Number(limit);
  }

  // Ensure the user set a value for the token limit
  // and if undefined - assume 4096 window.
  promptWindowLimit() {
    const limit = process.env.GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT || 4096;
    if (!limit || isNaN(Number(limit)))
      throw new Error("No token context limit was set.");
    return Number(limit);
  }

  // Short circuit since we have no idea if the model is valid or not
  // in pre-flight for generic endpoints
  isValidChatCompletionModel(_modelName = "") {
    return true;
  }

  /**
   * Generates appropriate content array for a message + attachments.
   *
   * ## Developer Note
   * This function assumes the generic OpenAI provider is _actually_ OpenAI compatible.
   * For example, Ollama is "OpenAI compatible" but does not support images as a content array.
   * The contentString also is the base64 string WITH `data:image/xxx;base64,` prefix, which may not be the case for all providers.
   * If your provider does not work exactly this way, then attachments will not function or potentially break vision requests.
   * If you encounter this issue, you are welcome to open an issue asking for your specific provider to be supported.
   *
   * This function will **not** be updated for providers that **do not** support images as a content array like OpenAI does.
   * Do not open issues to update this function due to your specific provider not being compatible. Open an issue to request support for your specific provider.
   * @param {Object} props
   * @param {string} props.userPrompt - the user prompt to be sent to the model
   * @param {import("../../helpers").Attachment[]} props.attachments - the array of attachments to be sent to the model
   * @returns {string|object[]}
   */
  #generateContent({ userPrompt, attachments = [] }) {
    if (!attachments.length) {
      return userPrompt;
    }

    const content = [{ type: "text", text: userPrompt }];
    for (let attachment of attachments) {
      content.push(
        attachmentToContentBlock(attachment, { imageDetail: "high" })
      );
    }
    return content.flat();
  }

  /**
   * Construct the user prompt for this model.
   * @param {{attachments: import("../../helpers").Attachment[]}} param0
   * @returns
   */
  constructPrompt({
    systemPrompt = "",
    contextTexts = [],
    chatHistory = [],
    userPrompt = "",
    attachments = [],
  }) {
    const prompt = {
      role: "system",
      content: `${systemPrompt}${this.#appendContext(contextTexts)}`,
    };
    return [
      prompt,
      ...formatChatHistory(chatHistory, this.#generateContent),
      {
        role: "user",
        content: this.#generateContent({ userPrompt, attachments }),
      },
    ];
  }

  /**
   * Extracts accurate generation-only timing and token count from a llama.cpp
   * response or streaming chunk. Mutates the provided usage object in place
   * so it can be used by both streaming and non-streaming code paths.
   * @param {Object} response - the API response or final streaming chunk
   * @param {Object} usage - the usage object to mutate
   */
  #extractLlamaCppTimings(response, usage) {
    if (!response || !response.timings) return;

    if (response.timings.hasOwnProperty("predicted_n"))
      usage.completion_tokens = Number(response.timings.predicted_n);

    if (response.timings.hasOwnProperty("predicted_ms"))
      usage.duration = Number(response.timings.predicted_ms) / 1000;
  }

  /**
   * Parses and prepends reasoning from the response and returns the full text response.
   * @param {Object} response
   * @returns {string}
   */
  #parseReasoningFromResponse({ message }) {
    let textResponse = message?.content;
    const reasoning = extractReasoningContent(message);
    if (reasoning && reasoning.trim().length > 0)
      textResponse = `<think>${reasoning}</think>${textResponse}`;
    return textResponse;
  }

  /**
   * Includes the usage in the response if the ENV flag is set
   * using the stream_options: { include_usage: true } option. This is available via ENV
   * because some providers will crash with invalid options.
   * @returns {Object}
   */
  #includeStreamOptionsUsage() {
    if (!("GENERIC_OPEN_AI_REPORT_USAGE" in process.env)) return {};
    if (process.env.GENERIC_OPEN_AI_REPORT_USAGE !== "true") return {};
    return {
      stream_options: {
        include_usage: true,
      },
    };
  }

  /**
   * Chat Completions request helper. Preserves the exact historical request
   * shape (temperature + max_tokens) for backwards compatibility.
   */
  #createChatCompletion({ messages, temperature, stream = false }) {
    return this.openai.chat.completions.create({
      model: this.model,
      ...(stream ? { stream: true } : {}),
      messages,
      temperature,
      max_tokens: this.maxTokens,
      ...(stream ? this.#includeStreamOptionsUsage() : {}),
    });
  }

  /**
   * Responses API request helper for single-turn chat.
   * - `messages` (chat-completions shape) are converted to Responses `input`.
   * - `max_tokens` becomes `max_output_tokens`.
   * - `temperature` is intentionally omitted: Responses-only reasoning
   *   deployments commonly reject it, and nothing downstream requires it.
   * - `store: false` is explicit here because single-turn chat never chains
   *   `previous_response_id`, so no server-side state needs retaining.
   */
  #createResponse({ messages, stream = false }) {
    return this.openai.responses.create(
      buildResponsesRequest({
        model: this.model,
        input: chatMessagesToResponsesInput(messages),
        maxOutputTokens: this.maxTokens,
        stream,
        store: false,
      })
    );
  }

  /**
   * Normalizes a Responses API result into the provider's existing return
   * contract ({textResponse, metrics}) so downstream code never sees
   * protocol-specific structures.
   */
  #parseResponsesResult(output, duration) {
    const usage = {
      ...normalizeResponsesUsage(output?.usage),
      duration,
    };
    const reasoning = extractResponsesReasoning(output);
    let textResponse = extractResponsesText(output);
    if (reasoning && reasoning.trim().length > 0)
      textResponse = `<think>${reasoning}</think>${textResponse}`;

    return {
      textResponse,
      metrics: {
        ...usage,
        outputTps:
          usage.duration > 0 ? usage.completion_tokens / usage.duration : 0,
        model: this.model,
        provider: this.className,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Rethrows SDK errors with the upstream message intact. Abort errors are
   * rethrown unwrapped so `isAbortError` still recognizes them.
   */
  #rethrowWithMessage(error) {
    if (isAbortError(error)) throw error;
    throw new Error(error?.message ?? String(error));
  }

  async getChatCompletion(messages = null, { temperature = 0.7 }) {
    if (this.apiMode() === RESPONSES_MODE) {
      const result = await LLMPerformanceMonitor.measureAsyncFunction(
        this.#createResponse({ messages }).catch((e) => {
          this.#rethrowWithMessage(e);
        })
      );
      return this.#parseResponsesResult(result.output, result.duration);
    }

    const result = await LLMPerformanceMonitor.measureAsyncFunction(
      this.#createChatCompletion({ messages, temperature }).catch((e) => {
        throw new Error(e.message);
      })
    );

    if (
      !result.output.hasOwnProperty("choices") ||
      result.output.choices.length === 0
    )
      return null;

    const usage = {
      prompt_tokens: result.output?.usage?.prompt_tokens || 0,
      completion_tokens: result.output?.usage?.completion_tokens || 0,
      total_tokens: result.output?.usage?.total_tokens || 0,
      duration: result.duration,
    };
    this.#extractLlamaCppTimings(result.output, usage);

    return {
      textResponse: this.#parseReasoningFromResponse(result.output.choices[0]),
      metrics: {
        ...usage,
        outputTps: usage.completion_tokens / usage.duration,
        model: this.model,
        provider: this.className,
        timestamp: new Date(),
      },
    };
  }

  async streamGetChatCompletion(messages = null, { temperature = 0.7 }) {
    if (this.apiMode() === RESPONSES_MODE) {
      const measuredStreamRequest = await LLMPerformanceMonitor.measureStream({
        func: this.#createResponse({ messages, stream: true }),
        messages,
        runPromptTokenCalculation: true,
        modelTag: this.model,
        provider: this.className,
      });
      return measuredStreamRequest;
    }

    const measuredStreamRequest = await LLMPerformanceMonitor.measureStream({
      func: this.#createChatCompletion({ messages, temperature, stream: true }),
      messages,
      runPromptTokenCalculation: true,
      modelTag: this.model,
      provider: this.className,
    });
    return measuredStreamRequest;
  }

  // TODO: This is a copy of the generic handleStream function in responses.js
  // to specifically handle the DeepSeek reasoning model `reasoning_content` field.
  // When or if ever possible, we should refactor this to be in the generic function.
  handleStream(response, stream, responseProps) {
    if (this.apiMode() === RESPONSES_MODE)
      return this.handleResponsesStream(response, stream, responseProps);

    const { uuid = uuidv4(), sources = [] } = responseProps;
    let hasUsageMetrics = false;
    let usage = {
      completion_tokens: 0,
    };

    return new Promise(async (resolve) => {
      let fullText = "";
      let reasoningText = "";

      // Establish listener to early-abort a streaming response
      // in case things go sideways or the user does not like the response.
      // We preserve the generated text but continue as if chat was completed
      // to preserve previously generated content.
      const handleAbort = () => {
        stream?.endMeasurement(usage);
        clientAbortedHandler(resolve, fullText);
      };
      response.on("close", handleAbort);

      try {
        for await (const chunk of stream) {
          const message = chunk?.choices?.[0];
          const token = message?.delta?.content;
          const reasoningToken = extractReasoningContent(message?.delta);

          if (
            chunk.hasOwnProperty("usage") && // exists
            !!chunk.usage && // is not null
            Object.values(chunk.usage).length > 0 // has values
          ) {
            if (chunk.usage.hasOwnProperty("prompt_tokens")) {
              usage.prompt_tokens = Number(chunk.usage.prompt_tokens);
            }

            if (chunk.usage.hasOwnProperty("completion_tokens")) {
              hasUsageMetrics = true; // to stop estimating counter
              usage.completion_tokens = Number(chunk.usage.completion_tokens);
            }
          }

          // Reasoning models will always return the reasoning text before the token text.
          if (reasoningToken) {
            // If the reasoning text is empty (''), we need to initialize it
            // and send the first chunk of reasoning text.
            if (reasoningText.length === 0) {
              writeResponseChunk(response, {
                uuid,
                sources: [],
                type: "textResponseChunk",
                textResponse: `<think>${reasoningToken}`,
                close: false,
                error: false,
              });
              reasoningText += `<think>${reasoningToken}`;
              continue;
            } else {
              writeResponseChunk(response, {
                uuid,
                sources: [],
                type: "textResponseChunk",
                textResponse: reasoningToken,
                close: false,
                error: false,
              });
              reasoningText += reasoningToken;
            }
          }

          // If the reasoning text is not empty, but the reasoning token is empty
          // and the token text is not empty we need to close the reasoning text and begin sending the token text.
          if (!!reasoningText && !reasoningToken && token) {
            writeResponseChunk(response, {
              uuid,
              sources: [],
              type: "textResponseChunk",
              textResponse: `</think>`,
              close: false,
              error: false,
            });
            fullText += `${reasoningText}</think>`;
            reasoningText = "";
          }

          if (token) {
            fullText += token;
            // If we never saw a usage metric, we can estimate them by number of completion chunks
            if (!hasUsageMetrics) usage.completion_tokens++;
            writeResponseChunk(response, {
              uuid,
              sources: [],
              type: "textResponseChunk",
              textResponse: token,
              close: false,
              error: false,
            });
          }

          if (
            message?.hasOwnProperty("finish_reason") && // Got valid message and it is an object with finish_reason
            message.finish_reason !== "" &&
            message.finish_reason !== null
          ) {
            writeResponseChunk(response, {
              uuid,
              sources,
              type: "textResponseChunk",
              textResponse: "",
              close: true,
              error: false,
            });
            this.#extractLlamaCppTimings(chunk, usage);

            response.removeListener("close", handleAbort);
            stream?.endMeasurement(usage);
            resolve(fullText);
            break; // Break streaming when a valid finish_reason is first encountered
          }
        }
      } catch (e) {
        // Cancelling the upstream request rejects the iterator - that is the
        // client leaving, not a failure, so it is not reported as an error.
        if (isAbortError(e)) {
          stream?.endMeasurement(usage);
          return clientAbortedHandler(resolve, fullText);
        }
        console.log(`\x1b[43m\x1b[34m[STREAMING ERROR]\x1b[0m ${e.message}`);
        writeResponseChunk(response, {
          uuid,
          type: "abort",
          textResponse: null,
          sources: [],
          close: true,
          error: e.message,
        });
        stream?.endMeasurement(usage);
        resolve(fullText);
      }
    });
  }

  /**
   * Handles a Responses API stream (`this.openai.responses.create` with
   * `stream: true`) and translates its events into the existing AnythingLLM
   * output stream contract (incremental `textResponseChunk` writes). Raw
   * Responses event JSON is never forwarded to the frontend.
   */
  handleResponsesStream(response, stream, responseProps) {
    const { uuid = uuidv4(), sources = [] } = responseProps;
    let hasUsageMetrics = false;
    let usage = {
      completion_tokens: 0,
    };

    const writeToken = (textResponse) => {
      writeResponseChunk(response, {
        uuid,
        sources: [],
        type: "textResponseChunk",
        textResponse,
        close: false,
        error: false,
      });
    };

    const applyResponsesUsage = (responsesUsage) => {
      if (!responsesUsage || typeof responsesUsage !== "object") return;
      if (
        responsesUsage.input_tokens != null ||
        responsesUsage.prompt_tokens != null
      ) {
        usage.prompt_tokens = Number(
          responsesUsage.input_tokens ?? responsesUsage.prompt_tokens
        );
      }
      if (
        responsesUsage.output_tokens != null ||
        responsesUsage.completion_tokens != null
      ) {
        hasUsageMetrics = true;
        usage.completion_tokens = Number(
          responsesUsage.output_tokens ?? responsesUsage.completion_tokens
        );
      }
      if (responsesUsage.total_tokens != null)
        usage.total_tokens = Number(responsesUsage.total_tokens);
    };

    // Some providers expose reasoning deltas on event types outside the
    // pinned SDK union (ex: reasoning summary streams). Extract liberally.
    const extractReasoningDelta = (event) => {
      if (!event || typeof event !== "object") return undefined;
      if (
        typeof event.delta === "string" &&
        /reasoning/i.test(event.type ?? "")
      )
        return event.delta;
      return undefined;
    };

    return new Promise(async (resolve) => {
      let fullText = "";
      let reasoningText = "";

      const handleAbort = () => {
        stream?.endMeasurement(usage);
        clientAbortedHandler(resolve, fullText);
      };
      response.on("close", handleAbort);

      const closeWithText = () => {
        writeResponseChunk(response, {
          uuid,
          sources,
          type: "textResponseChunk",
          textResponse: "",
          close: true,
          error: false,
        });
        response.removeListener("close", handleAbort);
        stream?.endMeasurement(usage);
        resolve(fullText);
      };

      const abortWithError = (message) => {
        writeResponseChunk(response, {
          uuid,
          type: "abort",
          textResponse: null,
          sources: [],
          close: true,
          error: message,
        });
        response.removeListener("close", handleAbort);
        stream?.endMeasurement(usage);
        resolve(fullText);
      };

      try {
        for await (const event of stream) {
          const type = event?.type ?? "";

          if (type === "response.output_text.delta") {
            const token = event.delta;
            const reasoningToken = extractReasoningContent(event);
            if (reasoningToken) {
              if (reasoningText.length === 0) {
                writeToken(`<think>${reasoningToken}`);
                reasoningText += `<think>${reasoningToken}`;
              } else {
                writeToken(reasoningToken);
                reasoningText += reasoningToken;
              }
              continue;
            }
            if (token) {
              if (reasoningText) {
                writeToken(`</think>`);
                fullText += `${reasoningText}</think>`;
                reasoningText = "";
              }
              fullText += token;
              if (!hasUsageMetrics) usage.completion_tokens++;
              writeToken(token);
            }
            continue;
          }

          if (type === "response.refusal.delta" && event.delta) {
            fullText += event.delta;
            if (!hasUsageMetrics) usage.completion_tokens++;
            writeToken(event.delta);
            continue;
          }

          const reasoningDelta = extractReasoningDelta(event);
          if (reasoningDelta) {
            if (reasoningText.length === 0) {
              writeToken(`<think>${reasoningDelta}`);
              reasoningText += `<think>${reasoningDelta}`;
            } else {
              writeToken(reasoningDelta);
              reasoningText += reasoningDelta;
            }
            continue;
          }

          if (type === "response.completed" || type === "response.incomplete") {
            applyResponsesUsage(event?.response?.usage);
            if (reasoningText) {
              // Incomplete reasoning without a following text delta still
              // needs its closing tag so the UI renders it correctly.
              writeToken(`</think>`);
              fullText += `${reasoningText}</think>`;
              reasoningText = "";
            }
            closeWithText();
            break;
          }

          if (type === "response.failed") {
            const message =
              event?.response?.error?.message ||
              "The Responses API request failed.";
            abortWithError(message);
            break;
          }

          if (type === "error") {
            abortWithError(
              event?.message || "The Responses API request failed."
            );
            break;
          }

          // All other event types (item added/done, content part markers,
          // function-call arguments in the tool-less chat path, lifecycle
          // pings) carry no displayable text and are intentionally ignored.
        }
      } catch (e) {
        if (isAbortError(e)) {
          stream?.endMeasurement(usage);
          return clientAbortedHandler(resolve, fullText);
        }
        console.log(`\x1b[43m\x1b[34m[STREAMING ERROR]\x1b[0m ${e.message}`);
        abortWithError(e.message);
      }
    });
  }

  /**
   * Check if a capability is supported via ENV configuration.
   * `tools` is opt-out (enabled unless explicitly disabled), all others are opt-in.
   * @param {'tools' | 'reasoning' | 'imageGeneration' | 'vision'} capability
   * @returns {boolean}
   */
  #supportsCapabilityFromENV(capability = "") {
    switch (capability) {
      case "tools":
        return !process.env.PROVIDER_DISABLE_NATIVE_TOOL_CALLING?.includes(
          "generic-openai"
        );
      case "reasoning":
        return !!process.env.PROVIDER_SUPPORTS_REASONING?.includes(
          "generic-openai"
        );
      case "imageGeneration":
        return !!process.env.PROVIDER_SUPPORTS_IMAGE_GENERATION?.includes(
          "generic-openai"
        );
      case "vision":
        return !!process.env.PROVIDER_SUPPORTS_VISION?.includes(
          "generic-openai"
        );
      default:
        return false;
    }
  }

  /**
   * Returns the capabilities of the model.
   * @returns {Promise<{tools: 'unknown' | boolean, reasoning: 'unknown' | boolean, imageGeneration: 'unknown' | boolean, vision: 'unknown' | boolean}>}
   */
  async getModelCapabilities() {
    try {
      return {
        tools: this.#supportsCapabilityFromENV("tools"),
        reasoning: this.#supportsCapabilityFromENV("reasoning"),
        imageGeneration: this.#supportsCapabilityFromENV("imageGeneration"),
        vision: this.#supportsCapabilityFromENV("vision"),
      };
    } catch (error) {
      console.error("Error getting model capabilities:", error);
      return {
        tools: "unknown",
        reasoning: "unknown",
        imageGeneration: "unknown",
        vision: "unknown",
      };
    }
  }

  // Simple wrapper for dynamic embedder & normalize interface for all LLM implementations
  async embedTextInput(textInput) {
    return await this.embedder.embedTextInput(textInput);
  }
  async embedChunks(textChunks = []) {
    return await this.embedder.embedChunks(textChunks);
  }

  async compressMessages(promptArgs = {}, rawHistory = []) {
    const { messageArrayCompressor } = require("../../helpers/chat");
    const messageArray = this.constructPrompt(promptArgs);
    return await messageArrayCompressor(this, messageArray, rawHistory);
  }
}

module.exports = {
  GenericOpenAiLLM,
};
