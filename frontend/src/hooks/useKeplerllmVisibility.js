import { useMemo } from "react";
import { readVisibilityFlags } from "@/utils/keplerllmVisibility";

// KeplerLLM fork: reads the normalized runtime visibility flags from
// `window.__KEPLERLLM_CONFIG__`. The payload is rendered per request by the
// server, so no fetch or state is needed; values are static for the page.
export default function useKeplerllmVisibility() {
  return useMemo(() => readVisibilityFlags(), []);
}
