import { useEffect, useState } from "react";
import System from "@/models/system";
import {
  isSettingsButtonsOverrideActive,
  subscribeSettingsButtonsOverride,
} from "@/utils/settingsButtonsVisibility";

// KeplerLLM fork: returns true when Settings buttons should be hidden.
// Server value comes from KEPLERLLM_HIDE_SETTINGS_BUTTONS via System.keys().
// window.showButtons() clears the hiding for the current tab only.
export default function useHideSettingsButtons() {
  const [serverHide, setServerHide] = useState(false);
  const [, setOverrideTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    System.keys()
      .then((settings) => {
        if (mounted) setServerHide(settings?.HideSettingsButtons === true);
      })
      .catch(() => {});
    const unsubscribe = subscribeSettingsButtonsOverride(() => {
      if (mounted) setOverrideTick((tick) => tick + 1);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (serverHide && isSettingsButtonsOverrideActive()) return false;
  return serverHide;
}
