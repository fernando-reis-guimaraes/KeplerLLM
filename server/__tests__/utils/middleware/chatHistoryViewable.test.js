const {
  chatHistoryViewable,
} = require("../../../utils/middleware/chatHistoryViewable");

describe("chatHistoryViewable middleware", () => {
  const originalValue = process.env.DISABLE_VIEW_CHAT_HISTORY;
  const hadValue = "DISABLE_VIEW_CHAT_HISTORY" in process.env;

  afterEach(() => {
    if (hadValue) {
      process.env.DISABLE_VIEW_CHAT_HISTORY = originalValue;
    } else {
      delete process.env.DISABLE_VIEW_CHAT_HISTORY;
    }
  });

  function mockResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
  }

  it("calls next when DISABLE_VIEW_CHAT_HISTORY is not present", () => {
    delete process.env.DISABLE_VIEW_CHAT_HISTORY;
    const next = jest.fn();

    chatHistoryViewable({}, mockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([["true"], ["TRUE"], [" true "], ["1"], [" 1 "]])(
    'returns 422 when DISABLE_VIEW_CHAT_HISTORY is "%s"',
    (value) => {
      process.env.DISABLE_VIEW_CHAT_HISTORY = value;
      const next = jest.fn();
      const response = mockResponse();

      chatHistoryViewable({}, response, next);

      expect(next).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(422);
      expect(response.send).toHaveBeenCalledWith(
        "This feature has been disabled by the administrator."
      );
    }
  );

  it.each([
    ["false"],
    ["FALSE"],
    [" false "],
    ["0"],
    [""],
    ["null"],
    ["undefined"],
    ["yes"],
    ["abc"],
  ])('calls next when DISABLE_VIEW_CHAT_HISTORY is "%s"', (value) => {
    process.env.DISABLE_VIEW_CHAT_HISTORY = value;
    const next = jest.fn();
    const response = mockResponse();

    chatHistoryViewable({}, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });
});
