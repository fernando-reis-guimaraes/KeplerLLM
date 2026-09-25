const {
  workspaceDeletionProtection,
} = require("../../../utils/middleware/workspaceDeletionProtection");

describe("workspaceDeletionProtection middleware", () => {
  const originalValue = process.env.WORKSPACE_DELETION_PROTECTION;
  const hadValue = "WORKSPACE_DELETION_PROTECTION" in process.env;

  afterEach(() => {
    if (hadValue) {
      process.env.WORKSPACE_DELETION_PROTECTION = originalValue;
    } else {
      delete process.env.WORKSPACE_DELETION_PROTECTION;
    }
  });

  it("calls next when WORKSPACE_DELETION_PROTECTION is not present", () => {
    delete process.env.WORKSPACE_DELETION_PROTECTION;
    const next = jest.fn();

    workspaceDeletionProtection({}, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([["true"], ["TRUE"], [" true "], ["1"], [" 1 "]])(
    'returns 403 when WORKSPACE_DELETION_PROTECTION is "%s"',
    (value) => {
      process.env.WORKSPACE_DELETION_PROTECTION = value;
      const next = jest.fn();
      const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      workspaceDeletionProtection({}, response, next);

      expect(next).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith({
        success: false,
        error: "Workspace deletion is blocked by the system administrator.",
      });
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
  ])('calls next when WORKSPACE_DELETION_PROTECTION is "%s"', (value) => {
    process.env.WORKSPACE_DELETION_PROTECTION = value;
    const next = jest.fn();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    workspaceDeletionProtection({}, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });
});
