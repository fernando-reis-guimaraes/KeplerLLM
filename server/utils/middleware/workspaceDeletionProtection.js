const {
  parseBooleanEnv,
} = require("../helpers/parseBooleanEnv");

/**
 * A simple middleware that blocks workspace deletion routes when the
 * `WORKSPACE_DELETION_PROTECTION` environment variable resolves to true
 * under strict boolean parsing (only "true"/"1" block; "false", "0", "",
 * unset, or any other value allows deletion).
 * @param {Request} request - The request object.
 * @param {Response} response - The response object.
 * @param {NextFunction} next - The next function.
 */
function workspaceDeletionProtection(_request, response, next) {
  if (!parseBooleanEnv(process.env.WORKSPACE_DELETION_PROTECTION))
    return next();
  return response.status(403).json({
    success: false,
    error: "Workspace deletion is blocked by the system administrator.",
  });
}

module.exports = {
  workspaceDeletionProtection,
};
