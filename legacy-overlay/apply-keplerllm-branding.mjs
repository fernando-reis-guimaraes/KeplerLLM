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

const modelPickerPath =
  "/src/frontend/src/components/WorkspaceChat/ChatContainer/WorkspaceModelPicker/index.jsx";
const metaGeneratorPath = "/src/server/utils/boot/MetaGenerator.js";
const openAiOptionsPath =
  "/src/frontend/src/components/LLMSelection/OpenAiOptions/index.jsx";

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

let metaGenerator = fs.readFileSync(metaGeneratorPath, "utf8");
const appScript =
  '            <script type="module" crossorigin src="/index.js"></script>';
metaGenerator = replaceExactlyOnce(
  metaGenerator,
  appScript,
  `            <script src="/keplerllm-config.js"></script>\n${appScript}`,
  "MetaGenerator"
);
fs.writeFileSync(metaGeneratorPath, metaGenerator);

let openAiOptions = fs.readFileSync(openAiOptionsPath, "utf8");
const unsortedOpenAiModels =
  "              {groupedModels[organization].map((model) => (";
const sortedOpenAiModels = `              {[...groupedModels[organization]]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((model) => (`;
openAiOptions = replaceExactlyOnce(
  openAiOptions,
  unsortedOpenAiModels,
  sortedOpenAiModels,
  "OpenAI model picker sorting"
);
fs.writeFileSync(openAiOptionsPath, openAiOptions);

console.log("Applied KeplerLLM UI branding and OpenAI model sorting patch.");
