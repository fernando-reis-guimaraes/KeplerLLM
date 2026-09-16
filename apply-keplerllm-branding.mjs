import fs from "node:fs";

function replaceExactlyOnce(text, needle, replacement, label) {
  const occurrences = text.split(needle).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${label}: expected exactly one match, found ${occurrences}. Upstream changed; review the KeplerLLM branding patch.`
    );
  }
  return text.replace(needle, replacement);
}

const indexHtmlPath = "/src/frontend/index.html";
const modelPickerPath =
  "/src/frontend/src/components/WorkspaceChat/ChatContainer/WorkspaceModelPicker/index.jsx";

let indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
const mainScript = '    <script type="module" src="/src/main.jsx"></script>';
indexHtml = replaceExactlyOnce(
  indexHtml,
  mainScript,
  `    <script src="/keplerllm-config.js"></script>\n${mainScript}`,
  "frontend/index.html"
);
fs.writeFileSync(indexHtmlPath, indexHtml);

let modelPicker = fs.readFileSync(modelPickerPath, "utf8");
const functionStart =
  "async function resolveModelName(workspace, systemSettings, t) {\n";
const brandedFunctionStart = `${functionStart}  const configuredDisplayName =\n    globalThis.__KEPLERLLM_CONFIG__?.modelDisplayName?.trim();\n  if (configuredDisplayName) return configuredDisplayName;\n\n`;
modelPicker = replaceExactlyOnce(
  modelPicker,
  functionStart,
  brandedFunctionStart,
  "WorkspaceModelPicker"
);
fs.writeFileSync(modelPickerPath, modelPicker);

console.log("Applied KeplerLLM model display-name branding patch.");
