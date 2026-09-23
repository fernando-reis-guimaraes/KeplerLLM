const {
  GenericOpenAiLLM,
} = require("../../../../utils/AiProviders/genericOpenAi");
const {
  resolveApiMode,
  chatMessagesToResponsesInput,
  agentMessagesToResponsesInput,
  agentMessagesToResponsesContinuationInput,
  normalizeResponsesUsage,
} = require("../../../../utils/AiProviders/genericOpenAi/responses.js");
const GenericOpenAiProvider = require("../../../../utils/agents/aibitat/providers/genericOpenAi.js");

const ORIGINAL_ENV = process.env;

function baseEnv(overrides = {}) {
  return {
    ...ORIGINAL_ENV,
    GENERIC_OPEN_AI_BASE_PATH: "http://localhost:8080/v1",
    GENERIC_OPEN_AI_MODEL_PREF: "test-model",
    GENERIC_OPEN_AI_MAX_TOKENS: "131072",
    ...overrides,
  };
}

function mockChatClient() {
  const provider = new GenericOpenAiLLM();
  provider.log = () => {};
  provider.openai = {
    chat: { completions: { create: jest.fn() } },
    responses: { create: jest.fn() },
  };
  return provider;
}

function mockAgentProvider() {
  const provider = new GenericOpenAiProvider({ model: "test-model" });
  provider.providerLog = () => {};
  provider._client = {
    chat: { completions: { create: jest.fn() } },
    responses: { create: jest.fn() },
  };
  return provider;
}

function mockHttpResponse() {
  return {
    on: jest.fn(),
    removeListener: jest.fn(),
    write: jest.fn(),
    writableEnded: false,
    destroyed: false,
  };
}

function writtenChunks(httpResponse) {
  return httpResponse.write.mock.calls.map((args) =>
    JSON.parse(String(args[0]).split("data: ")[1])
  );
}

async function* toAsyncIterable(events) {
  for (const event of events) yield event;
}

beforeEach(() => {
  process.env = baseEnv();
  jest.restoreAllMocks();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("GENERIC_OPEN_AI_API_MODE resolution", () => {
  it("defaults to chat-completions when the envvar is unset", () => {
    delete process.env.GENERIC_OPEN_AI_API_MODE;
    expect(resolveApiMode()).toBe("chat-completions");
    expect(new GenericOpenAiLLM().apiMode()).toBe("chat-completions");
  });

  it("supports explicit chat-completions", () => {
    process.env.GENERIC_OPEN_AI_API_MODE = "chat-completions";
    expect(resolveApiMode()).toBe("chat-completions");
  });

  it("supports explicit responses", () => {
    process.env.GENERIC_OPEN_AI_API_MODE = "responses";
    expect(resolveApiMode()).toBe("responses");
    expect(new GenericOpenAiLLM().apiMode()).toBe("responses");
    expect(mockAgentProvider().apiMode()).toBe("responses");
  });

  it("falls back to chat-completions with a warning on invalid values", () => {
    process.env.GENERIC_OPEN_AI_API_MODE = "graphql";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveApiMode()).toBe("chat-completions");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Invalid"));
    expect(new GenericOpenAiLLM().apiMode()).toBe("chat-completions");
  });
});

describe("Chat Completions regression (default mode)", () => {
  it("calls openai.chat.completions.create() and never responses.create()", async () => {
    delete process.env.GENERIC_OPEN_AI_API_MODE;
    const provider = mockChatClient();
    provider.openai.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: "hello" } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });

    const messages = [{ role: "user", content: "hi" }];
    const result = await provider.getChatCompletion(messages, {
      temperature: 0.7,
    });

    expect(provider.openai.chat.completions.create).toHaveBeenCalledWith({
      model: "test-model",
      messages,
      temperature: 0.7,
      max_tokens: 131072,
    });
    expect(provider.openai.responses.create).not.toHaveBeenCalled();
    expect(result.textResponse).toBe("hello");
    expect(result.metrics.provider).toBe("GenericOpenAiLLM");
  });

  it("streams via chat.completions in default mode", async () => {
    delete process.env.GENERIC_OPEN_AI_API_MODE;
    const provider = mockChatClient();
    provider.openai.chat.completions.create.mockResolvedValue(
      toAsyncIterable([
        { choices: [{ delta: { content: "hi" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ])
    );

    const stream = await provider.streamGetChatCompletion(
      [{ role: "user", content: "hi" }],
      { temperature: 0.7 }
    );
    const httpResponse = mockHttpResponse();
    const text = await provider.handleStream(httpResponse, stream, {
      uuid: "chat-regression",
      sources: [],
    });

    expect(provider.openai.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true, temperature: 0.7 })
    );
    expect(provider.openai.responses.create).not.toHaveBeenCalled();
    expect(text).toBe("hi");
  });
});

describe("Responses non-streaming chat", () => {
  beforeEach(() => {
    process.env.GENERIC_OPEN_AI_API_MODE = "responses";
  });

  it("calls openai.responses.create() with mapped inputs (no temperature)", async () => {
    const provider = mockChatClient();
    provider.openai.responses.create.mockResolvedValue({
      id: "resp_1",
      output_text: "hello",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "hello" }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    });

    const messages = [
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ];
    const result = await provider.getChatCompletion(messages, {
      temperature: 0.7,
    });

    expect(provider.openai.chat.completions.create).not.toHaveBeenCalled();
    expect(provider.openai.responses.create).toHaveBeenCalledWith({
      model: "test-model",
      input: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "hi" },
      ],
      stream: false,
      store: false,
      parallel_tool_calls: false,
      max_output_tokens: 131072,
    });
    // Temperature must not leak into Responses requests.
    expect(provider.openai.responses.create.mock.calls[0][0]).not.toHaveProperty(
      "temperature"
    );
    expect(provider.openai.responses.create.mock.calls[0][0]).not.toHaveProperty(
      "max_tokens"
    );
    expect(result.textResponse).toBe("hello");
  });

  it("normalizes usage into prompt/completion/total tokens + metrics", async () => {
    const provider = mockChatClient();
    provider.openai.responses.create.mockResolvedValue({
      id: "resp_2",
      output_text: "hi",
      output: [],
      usage: { input_tokens: 11, output_tokens: 6, total_tokens: 17 },
    });

    const result = await provider.getChatCompletion(
      [{ role: "user", content: "hi" }],
      {}
    );
    expect(result.metrics.prompt_tokens).toBe(11);
    expect(result.metrics.completion_tokens).toBe(6);
    expect(result.metrics.total_tokens).toBe(17);
    expect(result.metrics.model).toBe("test-model");
    expect(result.metrics.provider).toBe("GenericOpenAiLLM");
    expect(result.metrics.timestamp).toBeInstanceOf(Date);
    expect(typeof result.metrics.duration).toBe("number");
    expect(typeof result.metrics.outputTps).toBe("number");
  });

  it("wraps Responses reasoning output like chat-completions reasoning", async () => {
    const provider = mockChatClient();
    provider.openai.responses.create.mockResolvedValue({
      id: "resp_3",
      output_text: "done",
      output: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "thinking out loud" }],
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "done" }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
    });

    const result = await provider.getChatCompletion(
      [{ role: "user", content: "go" }],
      {}
    );
    expect(result.textResponse).toBe("<think>thinking out loud</think>done");
  });

  it("preserves upstream error messages instead of swallowing them", async () => {
    const provider = mockChatClient();
    provider.openai.responses.create.mockRejectedValue(
      new Error("model_not_found: no such model")
    );
    await expect(
      provider.getChatCompletion([{ role: "user", content: "hi" }], {})
    ).rejects.toThrow("model_not_found: no such model");
  });
});

describe("Responses streaming chat", () => {
  beforeEach(() => {
    process.env.GENERIC_OPEN_AI_API_MODE = "responses";
  });

  it("translates Responses events into textResponseChunk writes", async () => {
    const provider = mockChatClient();
    provider.openai.responses.create.mockResolvedValue(
      toAsyncIterable([
        { type: "response.output_text.delta", delta: "hel" },
        { type: "response.output_text.delta", delta: "lo" },
        {
          type: "response.completed",
          response: {
            id: "resp_stream",
            usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
          },
        },
      ])
    );

    const stream = await provider.streamGetChatCompletion(
      [{ role: "user", content: "hi" }],
      { temperature: 0.7 }
    );
    expect(provider.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true })
    );

    const httpResponse = mockHttpResponse();
    const text = await provider.handleStream(httpResponse, stream, {
      uuid: "stream-1",
      sources: [],
    });

    expect(text).toBe("hello");
    const chunks = writtenChunks(httpResponse);
    expect(chunks.length).toBeGreaterThan(0);
    // Incremental text reaches the UI.
    expect(
      chunks.filter((c) => c.type === "textResponseChunk" && !c.close)
    ).toEqual([
      expect.objectContaining({ textResponse: "hel" }),
      expect.objectContaining({ textResponse: "lo" }),
    ]);
    // Stream closes normally.
    expect(chunks[chunks.length - 1]).toEqual(
      expect.objectContaining({ close: true })
    );
    // Raw Responses event JSON never leaks to the frontend.
    for (const chunk of chunks)
      expect(JSON.stringify(chunk)).not.toContain("response.output_text.delta");
    expect(stream.metrics.completion_tokens).toBe(2);
    expect(stream.metrics.prompt_tokens).toBe(8);
  });

  it("surfaces Responses failures as abort chunks with the provider message", async () => {
    const provider = mockChatClient();
    provider.openai.responses.create.mockResolvedValue(
      toAsyncIterable([
        {
          type: "response.failed",
          response: { error: { message: "overloaded, try later" } },
        },
      ])
    );

    const stream = await provider.streamGetChatCompletion(
      [{ role: "user", content: "hi" }],
      {}
    );
    const httpResponse = mockHttpResponse();
    await provider.handleStream(httpResponse, stream, {
      uuid: "stream-fail",
      sources: [],
    });
    const chunks = writtenChunks(httpResponse);
    expect(chunks[chunks.length - 1]).toEqual(
      expect.objectContaining({ type: "abort", error: "overloaded, try later" })
    );
  });
});

describe("Responses message conversion", () => {
  it("preserves roles/ordering and converts content blocks", () => {
    const input = chatMessagesToResponsesInput([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAAA", detail: "high" },
          },
          {
            type: "input_audio",
            input_audio: { data: "BBBB", format: "mp3" },
          },
        ],
      },
      { role: "assistant", content: "prior reply" },
    ]);
    expect(input.map((m) => m.role)).toEqual([
      "system",
      "user",
      "user",
      "assistant",
    ]);
    expect(input[2].content).toEqual([
      { type: "input_text", text: "look" },
      {
        type: "input_image",
        image_url: "data:image/png;base64,AAAA",
        detail: "high",
      },
      { type: "input_audio", data: "BBBB", format: "mp3" },
    ]);
  });

  it("normalizes Responses usage without fabricating values", () => {
    expect(
      normalizeResponsesUsage({ input_tokens: 7, output_tokens: 3 })
    ).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
    expect(normalizeResponsesUsage({})).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });
});

describe("Responses agent tool calling", () => {
  const functions = [
    {
      name: "get-time",
      description: "Returns the current time",
      parameters: {
        type: "object",
        properties: { tz: { type: "string" } },
      },
    },
  ];

  beforeEach(() => {
    process.env.GENERIC_OPEN_AI_API_MODE = "responses";
  });

  it("normalizes a Responses tool call into the AIbitat shape", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create.mockResolvedValue({
      id: "resp_tool_1",
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "get-time",
          arguments: '{"tz":"UTC"}',
        },
      ],
    });

    const result = await provider.complete(
      [{ role: "user", content: "what time is it?" }],
      functions
    );

    const request = provider._client.responses.create.mock.calls[0][0];
    // First turn of a run: full input, no chaining, capped output.
    expect(request).toEqual({
      model: "test-model",
      input: [{ role: "user", content: "what time is it?" }],
      stream: false,
      parallel_tool_calls: false,
      max_output_tokens: 131072,
      tools: [
        {
          type: "function",
          name: "get-time",
          description: "Returns the current time",
          parameters: functions[0].parameters,
          strict: false,
        },
      ],
    });
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("previous_response_id");
    // store is omitted so the provider default applies and server-side
    // chaining is not defeated.
    expect(request).not.toHaveProperty("store");
    expect(result.functionCall).toEqual({
      id: "call_1",
      name: "get-time",
      arguments: { tz: "UTC" },
    });
    expect(result.textResponse).toBeNull();
    expect(result.usage.prompt_tokens).toBe(20);
    expect(result.usage.completion_tokens).toBe(8);
  });

  it("consumes only the first of simultaneous tool calls (one turn = one call)", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create.mockResolvedValue({
      id: "resp_multi",
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      output: [
        {
          type: "function_call",
          call_id: "call_a",
          name: "get-time",
          arguments: '{"tz":"UTC"}',
        },
        {
          type: "function_call",
          call_id: "call_b",
          name: "get-time",
          arguments: '{"tz":"PST"}',
        },
      ],
    });

    const result = await provider.complete(
      [{ role: "user", content: "both times" }],
      functions
    );
    // AIbitat executes one function call per model turn; parallel calls are
    // not fanned out, and parallel_tool_calls:false asks for serial turns.
    expect(
      provider._client.responses.create.mock.calls[0][0].parallel_tool_calls
    ).toBe(false);
    expect(result.functionCall).toEqual({
      id: "call_a",
      name: "get-time",
      arguments: { tz: "UTC" },
    });
  });

  it("sends tool outputs back and chains previous_response_id", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create
      .mockResolvedValueOnce({
        id: "resp_tool_1",
        usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "get-time",
            arguments: '{"tz":"UTC"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "resp_tool_2",
        usage: { input_tokens: 30, output_tokens: 6, total_tokens: 36 },
        output_text: "It is noon UTC.",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "It is noon UTC." }],
          },
        ],
      });

    const first = await provider.complete(
      [{ role: "user", content: "what time is it?" }],
      functions
    );
    expect(first.functionCall.name).toBe("get-time");

    const second = await provider.complete(
      [
        { role: "user", content: "what time is it?" },
        {
          role: "function",
          name: "get-time",
          content: "12:00 UTC",
          originalFunctionCall: first.functionCall,
        },
      ],
      functions
    );

    const request = provider._client.responses.create.mock.calls[1][0];
    // Stateful continuation: only the NEW tool output is sent. The previous
    // response already holds the user input and its function_call, so neither
    // may be resent.
    expect(request).toEqual({
      model: "test-model",
      input: [
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "12:00 UTC",
        },
      ],
      stream: false,
      parallel_tool_calls: false,
      max_output_tokens: 131072,
      tools: [
        {
          type: "function",
          name: "get-time",
          description: "Returns the current time",
          parameters: functions[0].parameters,
          strict: false,
        },
      ],
      previous_response_id: "resp_tool_1",
    });
    expect(JSON.stringify(request.input)).not.toContain("what time is it?");
    expect(JSON.stringify(request.input)).not.toContain('"function_call"');
    expect(second.functionCall).toBeNull();
    expect(second.textResponse).toBe("It is noon UTC.");
  });

  it("supports multiple sequential tool calls in one run", async () => {
    const provider = mockAgentProvider();
    const toolCall = (id, name, args) => ({
      id: `resp_${id}`,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      output: [
        { type: "function_call", call_id: id, name, arguments: args },
      ],
    });
    provider._client.responses.create
      .mockResolvedValueOnce(toolCall("call_1", "get-time", '{"tz":"UTC"}'))
      .mockResolvedValueOnce(toolCall("call_2", "get-time", '{"tz":"PST"}'))
      .mockResolvedValueOnce({
        id: "resp_final",
        usage: { input_tokens: 40, output_tokens: 9, total_tokens: 49 },
        output_text: "Both times reported.",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Both times reported." }],
          },
        ],
      });

    let messages = [{ role: "user", content: "times please" }];
    const turn1 = await provider.complete(messages, functions);
    messages = [
      ...messages,
      {
        role: "function",
        name: "get-time",
        content: "12:00 UTC",
        originalFunctionCall: turn1.functionCall,
      },
    ];
    const turn2 = await provider.complete(messages, functions);
    // Second turn chains resp_call_1 with only the new tool output.
    expect(provider._client.responses.create.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        previous_response_id: "resp_call_1",
        input: [
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "12:00 UTC",
          },
        ],
      })
    );
    messages = [
      ...messages,
      {
        role: "function",
        name: "get-time",
        content: "04:00 PST",
        originalFunctionCall: turn2.functionCall,
      },
    ];
    const turn3 = await provider.complete(messages, functions);
    // Third turn advances the chain (resp_call_1 -> resp_call_2) with only
    // the newest tool output; history is never replayed while chained.
    expect(provider._client.responses.create.mock.calls[2][0]).toEqual(
      expect.objectContaining({
        previous_response_id: "resp_call_2",
        input: [
          {
            type: "function_call_output",
            call_id: "call_2",
            output: "04:00 PST",
          },
        ],
      })
    );
    expect(turn3.functionCall).toBeNull();
    expect(turn3.textResponse).toBe("Both times reported.");
  });

  it("retries stateless when the provider rejects continuation", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create
      .mockResolvedValueOnce({
        id: "resp_tool_1",
        usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
        output: [
          {
            type: "function_call",
            call_id: "call_9",
            name: "get-time",
            arguments: "{}",
          },
        ],
      })
      .mockRejectedValueOnce(
        new Error("Unknown parameter: 'previous_response_id'")
      )
      .mockResolvedValueOnce({
        id: "resp_retry",
        usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 },
        output_text: "ok",
        output: [],
      });

    const first = await provider.complete(
      [{ role: "user", content: "time?" }],
      functions
    );
    const second = await provider.complete(
      [
        { role: "user", content: "time?" },
        {
          role: "function",
          name: "get-time",
          content: "noon",
          originalFunctionCall: first.functionCall,
        },
      ],
      functions
    );
    expect(provider._client.responses.create).toHaveBeenCalledTimes(3);
    const retryRequest = provider._client.responses.create.mock.calls[2][0];
    // The stateless fallback must be independently valid: no chaining id,
    // but the COMPLETE reconstructed input (user + function_call pair).
    // A delta-only payload here would reference a call the server never saw.
    expect(retryRequest).not.toHaveProperty("previous_response_id");
    expect(retryRequest.input).toEqual([
      { role: "user", content: "time?" },
      {
        type: "function_call",
        name: "get-time",
        call_id: "call_9",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_9",
        output: "noon",
      },
    ]);
    expect(second.textResponse).toBe("ok");
  });

  it("clears continuation state after the final answer (run isolation)", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create
      .mockResolvedValueOnce({
        id: "resp_run_a",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        output_text: "done A",
        output: [],
      })
      .mockResolvedValueOnce({
        id: "resp_run_b",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        output_text: "done B",
        output: [],
      });

    await provider.complete([{ role: "user", content: "run A" }], []);
    // A new conversation on the same instance must not receive resp_run_a,
    // even though its history is longer than the previous run's.
    const result = await provider.complete(
      [
        { role: "user", content: "run A" },
        { role: "assistant", content: "done A" },
        { role: "user", content: "run B" },
      ],
      []
    );
    expect(
      provider._client.responses.create.mock.calls[1][0]
    ).not.toHaveProperty("previous_response_id");
    expect(result.textResponse).toBe("done B");
  });

  it("resetCumulativeUsage drops pending continuation state", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create
      .mockResolvedValueOnce({
        id: "resp_pending",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        output: [
          {
            type: "function_call",
            call_id: "call_p",
            name: "get-time",
            arguments: "{}",
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "resp_after_reset",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        output_text: "fresh",
        output: [],
      });

    const first = await provider.complete(
      [{ role: "user", content: "time?" }],
      functions
    );
    expect(first.functionCall).not.toBeNull();
    // AIbitat calls this at depth 0 of every execution: the next turn must
    // start a new chain even though the history extends the old prefix.
    provider.resetCumulativeUsage();
    await provider.complete(
      [
        { role: "user", content: "time?" },
        {
          role: "function",
          name: "get-time",
          content: "noon",
          originalFunctionCall: first.functionCall,
        },
      ],
      functions
    );
    const request = provider._client.responses.create.mock.calls[1][0];
    expect(request).not.toHaveProperty("previous_response_id");
    expect(request.input).toEqual([
      { role: "user", content: "time?" },
      {
        type: "function_call",
        name: "get-time",
        call_id: "call_p",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_p",
        output: "noon",
      },
    ]);
  });

  it("does not leak response ids into unrelated conversations", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create.mockResolvedValue({
      id: "resp_other",
      usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
      output_text: "fresh answer",
      output: [],
    });

    const result = await provider.complete(
      [{ role: "user", content: "something entirely new" }],
      []
    );
    expect(
      provider._client.responses.create.mock.calls[0][0]
    ).not.toHaveProperty("previous_response_id");
    expect(result.textResponse).toBe("fresh answer");
  });

  it("streams Responses tool calls with normalized events", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create.mockResolvedValue(
      toAsyncIterable([
        {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            name: "get-time",
            call_id: "call_s1",
            arguments: "",
          },
        },
        {
          type: "response.function_call_arguments.delta",
          delta: '{"tz"',
        },
        {
          type: "response.function_call_arguments.delta",
          delta: ':"UTC"}',
        },
        {
          type: "response.completed",
          response: {
            id: "resp_s1",
            usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
          },
        },
      ])
    );

    const events = [];
    const result = await provider.stream(
      [{ role: "user", content: "time?" }],
      functions,
      (type, data) => events.push([type, data])
    );

    expect(provider._client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true })
    );
    expect(result.functionCall).toEqual({
      id: "call_s1",
      name: "get-time",
      arguments: { tz: "UTC" },
    });
    expect(
      events.filter(([, data]) => data.type === "toolCallInvocation").length
    ).toBeGreaterThan(0);
  });

  it("streams Responses text deltas as textResponseChunk events", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create.mockResolvedValue(
      toAsyncIterable([
        { type: "response.output_text.delta", delta: "hel" },
        { type: "response.output_text.delta", delta: "lo" },
        {
          type: "response.completed",
          response: {
            id: "resp_s2",
            usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 },
          },
        },
      ])
    );

    const events = [];
    const result = await provider.stream(
      [{ role: "user", content: "hi" }],
      [],
      (type, data) => events.push([type, data])
    );
    expect(result.functionCall).toBeNull();
    expect(result.textResponse).toBe("hello");
    expect(
      events
        .filter(([, data]) => data.type === "textResponseChunk")
        .map(([, data]) => data.content)
    ).toEqual(["hel", "lo"]);
  });

  it("sends max_output_tokens on streaming agent Responses requests", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create.mockResolvedValue(
      toAsyncIterable([
        { type: "response.output_text.delta", delta: "hi" },
        {
          type: "response.completed",
          response: {
            id: "resp_stream_max",
            usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
          },
        },
      ])
    );

    await provider.stream([{ role: "user", content: "hi" }], [], () => {});
    expect(provider._client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        max_output_tokens: 131072,
      })
    );
  });

  it("streams a tool continuation with delta-only input", async () => {
    const provider = mockAgentProvider();
    provider._client.responses.create
      .mockResolvedValueOnce({
        id: "resp_stream_tool_1",
        usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
        output: [
          {
            type: "function_call",
            call_id: "call_st1",
            name: "get-time",
            arguments: '{"tz":"UTC"}',
          },
        ],
      })
      .mockResolvedValue(
        toAsyncIterable([
          { type: "response.output_text.delta", delta: "noon" },
          {
            type: "response.completed",
            response: {
              id: "resp_stream_tool_2",
              usage: { input_tokens: 14, output_tokens: 2, total_tokens: 16 },
            },
          },
        ])
      );

    const first = await provider.complete(
      [{ role: "user", content: "time?" }],
      functions
    );
    const result = await provider.stream(
      [
        { role: "user", content: "time?" },
        {
          role: "function",
          name: "get-time",
          content: "12:00 UTC",
          originalFunctionCall: first.functionCall,
        },
      ],
      functions,
      () => {}
    );
    const request = provider._client.responses.create.mock.calls[1][0];
    expect(request).toEqual(
      expect.objectContaining({
        stream: true,
        previous_response_id: "resp_stream_tool_1",
        max_output_tokens: 131072,
      })
    );
    expect(request.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call_st1",
        output: "12:00 UTC",
      },
    ]);
    expect(result.textResponse).toBe("noon");
    expect(result.functionCall).toBeNull();
  });

  it("agentMessages conversion keeps attachments and skips orphan function results", () => {
    const logged = [];
    const input = agentMessagesToResponsesInput(
      [
        {
          role: "user",
          content: "see this",
          attachments: [
            {
              name: "image.png",
              mime: "image/png",
              contentString: "data:image/png;base64,AAAA",
            },
          ],
        },
        { role: "function", name: "x", content: "orphan" },
      ],
      { onSkipFunctionMessage: (message) => logged.push(message) }
    );
    expect(input[0]).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "see this" },
        {
          type: "input_image",
          image_url: "data:image/png;base64,AAAA",
          detail: "auto",
        },
      ],
    });
    expect(logged).toHaveLength(1);
  });

  it("continuation conversion emits only function_call_output for tool results", () => {
    const logged = [];
    const input = agentMessagesToResponsesContinuationInput(
      [
        {
          role: "function",
          name: "get-time",
          content: "12:00 UTC",
          originalFunctionCall: {
            id: "call_1",
            name: "get-time",
            arguments: { tz: "UTC" },
          },
        },
        {
          role: "user",
          content: "[Attached image(s) from tool result]",
          attachments: [
            {
              name: "image.png",
              mime: "image/png",
              contentString: "data:image/png;base64,AAAA",
            },
          ],
        },
        { role: "function", name: "x", content: "orphan" },
      ],
      { onSkipFunctionMessage: (message) => logged.push(message) }
    );
    // No duplicated function_call: the chained response already holds it.
    expect(input).toEqual([
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "12:00 UTC",
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "[Attached image(s) from tool result]" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,AAAA",
            detail: "auto",
          },
        ],
      },
    ]);
    expect(logged).toHaveLength(1);
  });
});
