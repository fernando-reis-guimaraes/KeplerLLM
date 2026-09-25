import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VISIBILITY_FLAGS,
  readKeplerllmConfig,
  readVisibilityFlags,
  shouldShowToolsButton,
  resolveQuickActionVisibility,
  hasVisibleQuickActions,
} from "./keplerllmVisibility.js";

describe("keplerllmVisibility defaults (backward compatibility)", () => {
  it("all flags default to false", () => {
    assert.deepEqual(
      { ...DEFAULT_VISIBILITY_FLAGS },
      {
        hideToolsButton: false,
        hideCreateAgentButton: false,
        hideEditWorkspaceButton: false,
        hideUploadDocumentButton: false,
      }
    );
    assert.deepEqual(readVisibilityFlags({}), {
      hideToolsButton: false,
      hideCreateAgentButton: false,
      hideEditWorkspaceButton: false,
      hideUploadDocumentButton: false,
    });
    assert.deepEqual(readVisibilityFlags(undefined ?? {}), {
      hideToolsButton: false,
      hideCreateAgentButton: false,
      hideEditWorkspaceButton: false,
      hideUploadDocumentButton: false,
    });
  });

  it("reads window.__KEPLERLLM_CONFIG__ when no override is given", () => {
    const original = globalThis.__KEPLERLLM_CONFIG__;
    const originalWindow = globalThis.window;
    try {
      delete globalThis.__KEPLERLLM_CONFIG__;
      globalThis.window = { __KEPLERLLM_CONFIG__: { hideToolsButton: true } };
      assert.deepEqual(readKeplerllmConfig(), { hideToolsButton: true });
      assert.equal(readVisibilityFlags().hideToolsButton, true);
    } finally {
      if (original === undefined) delete globalThis.__KEPLERLLM_CONFIG__;
      else globalThis.__KEPLERLLM_CONFIG__ = original;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });

  it("only an explicit true boolean hides (no truthiness)", () => {
    assert.equal(
      readVisibilityFlags({ hideToolsButton: "true" }).hideToolsButton,
      false
    );
    assert.equal(
      readVisibilityFlags({ hideToolsButton: 1 }).hideToolsButton,
      false
    );
    assert.equal(
      readVisibilityFlags({ hideToolsButton: "false" }).hideToolsButton,
      false
    );
    assert.equal(
      readVisibilityFlags({ hideToolsButton: "" }).hideToolsButton,
      false
    );
    assert.equal(
      readVisibilityFlags({ hideToolsButton: true }).hideToolsButton,
      true
    );
  });
});

describe("Tools button visibility", () => {
  it("is visible by default", () => {
    assert.equal(shouldShowToolsButton({}), true);
    assert.equal(
      shouldShowToolsButton({
        hideToolsButton: false,
        hideCreateAgentButton: false,
        hideEditWorkspaceButton: false,
        hideUploadDocumentButton: false,
      }),
      true
    );
  });

  it("is hidden by runtime config", () => {
    assert.equal(shouldShowToolsButton({ hideToolsButton: true }), false);
  });

  it("is not affected by unrelated flags", () => {
    assert.equal(
      shouldShowToolsButton({
        hideToolsButton: false,
        hideCreateAgentButton: true,
        hideEditWorkspaceButton: true,
        hideUploadDocumentButton: true,
      }),
      true
    );
  });
});

describe("Quick Action visibility", () => {
  it("shows all permitted actions by default for an admin with workspace", () => {
    assert.deepEqual(
      resolveQuickActionVisibility({
        user: { role: "admin" },
        hasAvailableWorkspace: true,
        runtimeConfig: {},
      }),
      {
        showCreateAgent: true,
        showEditWorkspace: true,
        showUploadDocument: true,
      }
    );
  });

  it("hides only Create Agent when its flag is set", () => {
    assert.deepEqual(
      resolveQuickActionVisibility({
        user: { role: "admin" },
        hasAvailableWorkspace: true,
        runtimeConfig: { hideCreateAgentButton: true },
      }),
      {
        showCreateAgent: false,
        showEditWorkspace: true,
        showUploadDocument: true,
      }
    );
  });

  it("hides only Edit Workspace when its flag is set", () => {
    assert.deepEqual(
      resolveQuickActionVisibility({
        user: { role: "admin" },
        hasAvailableWorkspace: true,
        runtimeConfig: { hideEditWorkspaceButton: true },
      }),
      {
        showCreateAgent: true,
        showEditWorkspace: false,
        showUploadDocument: true,
      }
    );
  });

  it("hides only Upload Document when its flag is set", () => {
    assert.deepEqual(
      resolveQuickActionVisibility({
        user: { role: "admin" },
        hasAvailableWorkspace: true,
        runtimeConfig: { hideUploadDocumentButton: true },
      }),
      {
        showCreateAgent: true,
        showEditWorkspace: true,
        showUploadDocument: false,
      }
    );
  });

  it("preserves existing role restrictions (non-admin cannot create agents)", () => {
    const manager = resolveQuickActionVisibility({
      user: { role: "manager" },
      hasAvailableWorkspace: true,
      runtimeConfig: {},
    });
    assert.equal(manager.showCreateAgent, false);
    assert.equal(manager.showEditWorkspace, true);
    assert.equal(manager.showUploadDocument, true);

    const hiddenManager = resolveQuickActionVisibility({
      user: { role: "manager" },
      hasAvailableWorkspace: true,
      runtimeConfig: { hideEditWorkspaceButton: true },
    });
    assert.equal(hiddenManager.showEditWorkspace, false);
  });

  it("preserves workspace requirement for Edit Workspace", () => {
    const withoutWorkspace = resolveQuickActionVisibility({
      user: { role: "admin" },
      hasAvailableWorkspace: false,
      runtimeConfig: {},
    });
    assert.equal(withoutWorkspace.showEditWorkspace, false);
    assert.equal(withoutWorkspace.showCreateAgent, true);
    assert.equal(withoutWorkspace.showUploadDocument, true);
  });

  it("reports no visible actions when all are hidden", () => {
    const allHidden = resolveQuickActionVisibility({
      user: { role: "admin" },
      hasAvailableWorkspace: true,
      runtimeConfig: {
        hideCreateAgentButton: true,
        hideEditWorkspaceButton: true,
        hideUploadDocumentButton: true,
      },
    });
    assert.deepEqual(allHidden, {
      showCreateAgent: false,
      showEditWorkspace: false,
      showUploadDocument: false,
    });
    assert.equal(
      hasVisibleQuickActions({
        user: { role: "admin" },
        hasAvailableWorkspace: true,
        runtimeConfig: {
          hideCreateAgentButton: true,
          hideEditWorkspaceButton: true,
          hideUploadDocumentButton: true,
        },
      }),
      false
    );
  });

  it("reports visible actions when only one remains", () => {
    assert.equal(
      hasVisibleQuickActions({
        user: { role: "admin" },
        hasAvailableWorkspace: true,
        runtimeConfig: {
          hideCreateAgentButton: true,
          hideEditWorkspaceButton: true,
        },
      }),
      true
    );
    assert.equal(
      hasVisibleQuickActions({
        user: { role: "admin" },
        hasAvailableWorkspace: false,
        runtimeConfig: {},
      }),
      true
    );
  });
});
