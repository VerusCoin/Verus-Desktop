"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  AUTHORIZATION_SCOPES,
  createNativeAuthorizationService,
} = require("../routes/api/native/nativeAuthorization");

const interactiveWindow = (overrides = {}) => ({
  isDestroyed: () => false,
  isVisible: () => true,
  isFocused: () => true,
  webContents: { isDestroyed: () => false },
  ...overrides,
});

const authorizationRequest = (scope, overrides = {}) => ({
  scope,
  actionId: `/test/${scope}`,
  title: "Authorize Test Action",
  message: "A protected test action is ready.",
  detail: "Review this action before approving it.",
  confirmLabel: "Authorize Once",
  ...overrides,
});

const createService = (overrides = {}) => {
  const parentWindow = overrides.parentWindow || interactiveWindow();
  return createNativeAuthorizationService({
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    getParentWindow: () => parentWindow,
    minPromptIntervalMs: 0,
    ...overrides,
  });
};

describe("central native authorization", function () {
  it("defaults irreversible-action authorization on and skips it only for literal false", async function () {
    const parentWindow = interactiveWindow();
    const dialogs = [];
    const defaultOn = createNativeAuthorizationService({
      dialog: {
        showMessageBox: async (parent, options) => {
          dialogs.push({ parent, options });
          return { response: 1 };
        },
      },
      getParentWindow: () => parentWindow,
      minPromptIntervalMs: 0,
      createOperationId: () => "default-on-operation",
    });

    assert.deepStrictEqual(
      await defaultOn.authorize(
        authorizationRequest(AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION)
      ),
      { status: "approved", operationId: "default-on-operation" }
    );
    assert.strictEqual(dialogs.length, 1);
    assert.strictEqual(dialogs[0].parent, parentWindow);
    assert.deepStrictEqual(dialogs[0].options.buttons, ["Cancel", "Authorize Once"]);
    assert.strictEqual(dialogs[0].options.defaultId, 0);
    assert.strictEqual(dialogs[0].options.cancelId, 0);
    assert.strictEqual(dialogs[0].options.noLink, true);

    let disabledDialogCount = 0;
    const disabled = createService({
      dialog: {
        showMessageBox: async () => {
          disabledDialogCount += 1;
          return { response: 1 };
        },
      },
      isIrreversibleAuthorizationEnabled: () => false,
    });

    assert.deepStrictEqual(
      await disabled.authorize(
        authorizationRequest(AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION)
      ),
      { status: "not-required" }
    );
    assert.strictEqual(disabledDialogCount, 0);

    const undefinedSetting = createService({
      isIrreversibleAuthorizationEnabled: () => undefined,
      createOperationId: () => "undefined-setting-operation",
    });
    assert.deepStrictEqual(
      await undefinedSetting.authorize(
        authorizationRequest(AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION)
      ),
      { status: "approved", operationId: "undefined-setting-operation" }
    );
  });

  it("keeps every non-configurable security scope protected when irreversible prompts are off", async function () {
    const scopes = Object.values(AUTHORIZATION_SCOPES).filter(
      (scope) => scope !== AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION
    );
    const promptedScopes = [];
    const service = createService({
      dialog: {
        showMessageBox: async (parent, options) => {
          promptedScopes.push(options.detail);
          return { response: 0 };
        },
      },
      isIrreversibleAuthorizationEnabled: () => false,
    });

    for (const scope of scopes) {
      const outcome = await service.authorize(
        authorizationRequest(scope, { detail: `scope:${scope}` })
      );
      assert.deepStrictEqual(outcome, { status: "cancelled" }, scope);
    }

    assert.deepStrictEqual(
      promptedScopes,
      scopes.map((scope) => `scope:${scope}`)
    );
  });

  it("requires a live, visible, focused trusted parent before showing a prompt", async function () {
    const unavailableWindows = [
      null,
      interactiveWindow({ isDestroyed: () => true }),
      interactiveWindow({ webContents: { isDestroyed: () => true } }),
      interactiveWindow({ isVisible: () => false }),
      interactiveWindow({ isFocused: () => false }),
    ];

    for (const parentWindow of unavailableWindows) {
      let promptCount = 0;
      const service = createNativeAuthorizationService({
        dialog: {
          showMessageBox: async () => {
            promptCount += 1;
            return { response: 1 };
          },
        },
        getParentWindow: () => parentWindow,
      });
      const outcome = await service.authorize(
        authorizationRequest(AUTHORIZATION_SCOPES.SENSITIVE_DATA)
      );
      assert.strictEqual(outcome.status, "error");
      assert.strictEqual(outcome.code, "WINDOW_UNAVAILABLE");
      assert.strictEqual(promptCount, 0);
    }

    const firstWindow = interactiveWindow();
    const secondWindow = interactiveWindow();
    let currentWindow = firstWindow;
    const changedParent = createService({
      getParentWindow: () => currentWindow,
      dialog: {
        showMessageBox: async () => {
          currentWindow = secondWindow;
          return { response: 1 };
        },
      },
    });
    const changedOutcome = await changedParent.authorize(
      authorizationRequest(AUTHORIZATION_SCOPES.WALLET_AUTHORITY)
    );
    assert.strictEqual(changedOutcome.status, "error");
    assert.strictEqual(changedOutcome.code, "WINDOW_UNAVAILABLE");
  });

  it("passes the caller selector to a focused consent-plugin parent resolver", async function () {
    const mainWindow = interactiveWindow();
    const focusedConsentWindow = interactiveWindow();
    let consentWindow = null;
    let promptParent = null;
    const service = createNativeAuthorizationService({
      dialog: {
        showMessageBox: async (parent) => {
          promptParent = parent;
          return { response: 1 };
        },
      },
      getParentWindow(request) {
        if (!request.callerAppId || request.callerAppId === "VERUS_DESKTOP_MAIN") {
          return mainWindow;
        }
        if (request.callerAppId === "VERUS_LOGIN_CONSENT_UI") return consentWindow;
        return null;
      },
      minPromptIntervalMs: 0,
    });
    const consentRequest = authorizationRequest(
      AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION,
      { callerAppId: "VERUS_LOGIN_CONSENT_UI" }
    );

    assert.strictEqual((await service.authorize(consentRequest)).code, "WINDOW_UNAVAILABLE");
    consentWindow = interactiveWindow({ isFocused: () => false });
    assert.strictEqual((await service.authorize(consentRequest)).code, "WINDOW_UNAVAILABLE");
    consentWindow = focusedConsentWindow;
    assert.strictEqual((await service.authorize(consentRequest)).status, "approved");
    assert.strictEqual(promptParent, focusedConsentWindow);

    assert.strictEqual((await service.authorize({
      ...consentRequest,
      callerAppId: "VERUS_PBAAS_VISUALIZER",
    })).code, "WINDOW_UNAVAILABLE");
  });

  it("coordinates concurrency and prompt rate limits globally across scopes", async function () {
    const parentWindow = interactiveWindow();
    let releaseFirstPrompt;
    let now = 10_000;
    let promptCount = 0;
    const service = createNativeAuthorizationService({
      dialog: {
        showMessageBox: async () => {
          promptCount += 1;
          if (promptCount === 1) {
            await new Promise((resolve) => {
              releaseFirstPrompt = resolve;
            });
          }
          return { response: 0 };
        },
      },
      getParentWindow: () => parentWindow,
      now: () => now,
      minPromptIntervalMs: 750,
      maxPromptsPerWindow: 2,
      promptWindowMs: 60_000,
    });

    const first = service.authorize(
      authorizationRequest(AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION)
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(service.isBusy(), true);

    const overlapping = await service.authorize(
      authorizationRequest(AUTHORIZATION_SCOPES.SENSITIVE_DATA)
    );
    assert.strictEqual(overlapping.status, "error");
    assert.strictEqual(overlapping.code, "BUSY");
    assert.strictEqual(promptCount, 1);

    releaseFirstPrompt();
    assert.deepStrictEqual(await first, { status: "cancelled" });
    assert.strictEqual(service.isBusy(), false);

    now += 100;
    const tooSoon = await service.authorize(
      authorizationRequest(AUTHORIZATION_SCOPES.TERMINAL_RPC)
    );
    assert.strictEqual(tooSoon.status, "error");
    assert.strictEqual(tooSoon.code, "RATE_LIMITED");
    assert.strictEqual(promptCount, 1);

    now += 750;
    assert.deepStrictEqual(
      await service.authorize(
        authorizationRequest(AUTHORIZATION_SCOPES.SECURITY_SETTING)
      ),
      { status: "cancelled" }
    );
    assert.strictEqual(promptCount, 2);

    now += 750;
    const windowLimit = await service.authorize(
      authorizationRequest(AUTHORIZATION_SCOPES.SECURITY_DECISION)
    );
    assert.strictEqual(windowLimit.status, "error");
    assert.strictEqual(windowLimit.code, "RATE_LIMITED");
    assert.strictEqual(promptCount, 2);
  });
});
