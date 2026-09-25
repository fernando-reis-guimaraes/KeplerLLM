const {
  parseBooleanEnv,
} = require("../helpers/parseBooleanEnv");

/**
 * A simple middleware that validates that the chat history is viewable.
 * via the `DISABLE_VIEW_CHAT_HISTORY` environment variable resolving to true
 * under strict boolean parsing (only "true"/"1" disable; "false", "0", "",
 * unset, or any other value keeps history viewable).
 * @param {Request} request - The request object.
 * @param {Response} response - The response object.
 * @param {NextFunction} next - The next function.
 */
function chatHistoryViewable(_request, response, next) {
  if (parseBooleanEnv(process.env.DISABLE_VIEW_CHAT_HISTORY))
    return response
      .status(422)
      .send("This feature has been disabled by the administrator.");
  next();
}

module.exports = {
  chatHistoryViewable,
};
