"use strict";

const { randomBytes } = require("crypto");

const AUTHORIZATION_SCOPES = Object.freeze({
  IRREVERSIBLE_ACTION: "irreversible-action",
  SECURITY_DECISION: "security-decision",
  SECURITY_SETTING: "security-setting",
  SENSITIVE_DATA: "sensitive-data",
  TERMINAL_RPC: "terminal-rpc",
  WALLET_AUTHORITY: "wallet-authority",
});

const KNOWN_SCOPES = new Set(Object.values(AUTHORIZATION_SCOPES));
const DEFAULT_MIN_PROMPT_INTERVAL_MS = 750;
const DEFAULT_MAX_PROMPTS_PER_WINDOW = 20;
const DEFAULT_PROMPT_WINDOW_MS = 60 * 1000;

const fixedError = (code, message) => ({ status: "error", code, message });

const isAvailableWindow = (window) => {
  if (window == null || typeof window.isDestroyed !== "function" || window.isDestroyed()) {
    return false;
  }
  if (
    window.webContents != null &&
    typeof window.webContents.isDestroyed === "function" &&
    window.webContents.isDestroyed()
  ) {
    return false;
  }
  return true;
};

const isInteractiveWindow = (window) =>
  isAvailableWindow(window) &&
  (typeof window.isVisible !== "function" || window.isVisible()) &&
  (typeof window.isFocused !== "function" || window.isFocused());

const snapshotText = (value, field, maxLength) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new TypeError(`Invalid native authorization ${field}`);
  }
  return value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
};

const createNativeAuthorizationRequest = (rawRequest) => {
  if (rawRequest == null || typeof rawRequest !== "object" || Array.isArray(rawRequest)) {
    throw new TypeError("Invalid native authorization request");
  }

  const scope = rawRequest.scope;
  if (!KNOWN_SCOPES.has(scope)) throw new TypeError("Invalid native authorization scope");

  const actionId = snapshotText(rawRequest.actionId, "action id", 192);
  if (!/^[0-9a-z._:/-]+$/i.test(actionId)) {
    throw new TypeError("Invalid native authorization action id");
  }

  let callerAppId;
  if (rawRequest.callerAppId != null) {
    callerAppId = snapshotText(rawRequest.callerAppId, "caller application id", 192);
    if (!/^[0-9a-z._:-]+$/i.test(callerAppId)) {
      throw new TypeError("Invalid native authorization caller application id");
    }
  }

  return Object.freeze({
    scope,
    actionId,
    title: snapshotText(rawRequest.title, "title", 160),
    message: snapshotText(rawRequest.message, "message", 2000),
    detail: snapshotText(rawRequest.detail, "detail", 16 * 1024),
    confirmLabel: snapshotText(rawRequest.confirmLabel, "confirmation label", 80),
    ...(callerAppId == null ? {} : { callerAppId }),
  });
};

/**
 * Creates the single main-process authorization gate used by every privileged
 * native prompt. It intentionally issues no reusable approval token: one
 * accepted prompt authorizes one already-decoded backend operation.
 */
const createNativeAuthorizationService = (dependencies = {}) => {
  const {
    dialog,
    getParentWindow,
    isIrreversibleAuthorizationEnabled = () => true,
    createOperationId = () => randomBytes(12).toString("hex"),
    audit = () => {},
    now = () => Date.now(),
    minPromptIntervalMs = DEFAULT_MIN_PROMPT_INTERVAL_MS,
    maxPromptsPerWindow = DEFAULT_MAX_PROMPTS_PER_WINDOW,
    promptWindowMs = DEFAULT_PROMPT_WINDOW_MS,
  } = dependencies;

  if (dialog == null || typeof dialog.showMessageBox !== "function") {
    throw new TypeError("A native dialog dependency is required");
  }
  if (typeof getParentWindow !== "function") {
    throw new TypeError("getParentWindow must be a function");
  }
  if (typeof isIrreversibleAuthorizationEnabled !== "function") {
    throw new TypeError("isIrreversibleAuthorizationEnabled must be a function");
  }
  if (
    !Number.isFinite(minPromptIntervalMs) || minPromptIntervalMs < 0 ||
    !Number.isSafeInteger(maxPromptsPerWindow) || maxPromptsPerWindow < 1 ||
    !Number.isFinite(promptWindowMs) || promptWindowMs <= 0
  ) {
    throw new TypeError("Invalid native authorization rate limits");
  }

  let promptActive = false;
  const promptTimes = [];

  const auditSafe = (event) => {
    try {
      audit(Object.freeze({ ...event }));
    } catch (error) {
      // Authorization must not become retryable because logging failed.
    }
  };

  const checkAndRecordPromptRate = () => {
    const currentTime = now();
    while (promptTimes.length && currentTime - promptTimes[0] >= promptWindowMs) {
      promptTimes.shift();
    }
    const lastPrompt = promptTimes[promptTimes.length - 1];
    if (
      promptTimes.length >= maxPromptsPerWindow ||
      (lastPrompt != null && currentTime - lastPrompt < minPromptIntervalMs)
    ) {
      return false;
    }
    promptTimes.push(currentTime);
    return true;
  };

  const authorizationIsRequired = (request) => {
    if (request.scope !== AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION) return true;
    // Fail closed if the setting cannot be read. Only a literal false disables
    // prompts, which also makes upgrades from older config files default on.
    return isIrreversibleAuthorizationEnabled() !== false;
  };

  const authorize = async (rawRequest) => {
    let request;
    try {
      request = createNativeAuthorizationRequest(rawRequest);
    } catch (error) {
      return fixedError("INVALID_REQUEST", "Invalid native authorization request.");
    }

    let required;
    try {
      required = authorizationIsRequired(request);
    } catch (error) {
      auditSafe({ scope: request.scope, actionId: request.actionId, outcome: "policy-failed" });
      return fixedError("POLICY_FAILED", "Native authorization policy failed closed.");
    }
    if (!required) {
      auditSafe({ scope: request.scope, actionId: request.actionId, outcome: "disabled-by-user" });
      return { status: "not-required" };
    }

    if (promptActive) {
      auditSafe({ scope: request.scope, actionId: request.actionId, outcome: "busy" });
      return fixedError("BUSY", "Another security authorization is awaiting approval.");
    }

    promptActive = true;
    let operationId;
    try {
      operationId = createOperationId();
      if (typeof operationId !== "string" || operationId.length === 0) {
        auditSafe({ scope: request.scope, actionId: request.actionId, outcome: "operation-id-failed" });
        return fixedError("INTERNAL_ERROR", "Native authorization failed closed.");
      }

      const parentWindow = getParentWindow(request);
      if (!isInteractiveWindow(parentWindow)) {
        auditSafe({ operationId, scope: request.scope, actionId: request.actionId, outcome: "window-unavailable" });
        return fixedError(
          "WINDOW_UNAVAILABLE",
          "Focus the Verus Desktop window before authorizing this operation."
        );
      }
      if (!checkAndRecordPromptRate()) {
        auditSafe({ operationId, scope: request.scope, actionId: request.actionId, outcome: "rate-limited" });
        return fixedError(
          "RATE_LIMITED",
          "Too many security authorization prompts. Wait and try again."
        );
      }

      let confirmation;
      try {
        confirmation = await dialog.showMessageBox(parentWindow, {
          type: "warning",
          title: request.title,
          message: request.message,
          detail: request.detail,
          buttons: ["Cancel", request.confirmLabel],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      } catch (error) {
        auditSafe({ operationId, scope: request.scope, actionId: request.actionId, outcome: "dialog-error" });
        return fixedError("DIALOG_FAILED", "Unable to obtain native authorization.");
      }

      if (confirmation == null || confirmation.response !== 1) {
        auditSafe({ operationId, scope: request.scope, actionId: request.actionId, outcome: "cancelled" });
        return { status: "cancelled" };
      }
      if (getParentWindow(request) !== parentWindow || !isInteractiveWindow(parentWindow)) {
        auditSafe({ operationId, scope: request.scope, actionId: request.actionId, outcome: "window-lost" });
        return fixedError(
          "WINDOW_UNAVAILABLE",
          "The trusted application window is no longer available."
        );
      }

      auditSafe({ operationId, scope: request.scope, actionId: request.actionId, outcome: "approved" });
      return { status: "approved", operationId };
    } catch (error) {
      auditSafe({ operationId, scope: request.scope, actionId: request.actionId, outcome: "internal-error" });
      return fixedError("INTERNAL_ERROR", "Native authorization failed closed.");
    } finally {
      request = null;
      promptActive = false;
    }
  };

  return Object.freeze({
    authorize,
    isBusy: () => promptActive,
  });
};

module.exports = {
  AUTHORIZATION_SCOPES,
  createNativeAuthorizationRequest,
  createNativeAuthorizationService,
  isAvailableWindow,
  isInteractiveWindow,
};
