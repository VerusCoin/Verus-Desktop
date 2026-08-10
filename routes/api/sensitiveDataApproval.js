"use strict";

const { randomBytes } = require("crypto");
const { isAvailableWindow } = require("./native/terminalRpcApproval");
const { escapeInvisibleCharacters } = require("./native/terminalRpcSecurity");

const MAIN_APPLICATION_ID = "VERUS_DESKTOP_MAIN";
const DEFAULT_MIN_PROMPT_INTERVAL_MS = 750;
const DEFAULT_MAX_PROMPTS_PER_WINDOW = 8;
const DEFAULT_PROMPT_WINDOW_MS = 60 * 1000;
const MAX_SECRET_LENGTH = 1024 * 1024;

const SOURCE_POLICY = Object.freeze({
  native: Object.freeze({ kind: "private-key", label: "Native wallet" }),
  electrum: Object.freeze({ kind: "private-key", label: "Lite wallet" }),
  eth: Object.freeze({ kind: "private-key", label: "Ethereum wallet" }),
  erc20: Object.freeze({ kind: "private-key", label: "ERC-20 wallet" }),
  pin: Object.freeze({ kind: "seed", label: "Encrypted profile" }),
});

const fixedError = (code, message) => ({ status: "error", code, message });

const isInteractiveWindow = (window) =>
  isAvailableWindow(window) &&
  (typeof window.isVisible !== "function" || window.isVisible()) &&
  (typeof window.isFocused !== "function" || window.isFocused());

const snapshotOptionalString = (value, field, maxLength) => {
  if (value == null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
};

const createSensitiveRevealRequest = (rawRequest) => {
  if (rawRequest == null || typeof rawRequest !== "object" || Array.isArray(rawRequest)) {
    throw new TypeError("Invalid sensitive reveal request");
  }

  const source = rawRequest.source;
  const policy = SOURCE_POLICY[source];
  if (!policy || rawRequest.kind !== policy.kind) {
    throw new TypeError("Invalid sensitive reveal source or kind");
  }
  if (
    rawRequest.callerBuiltin !== true ||
    rawRequest.callerAppId !== MAIN_APPLICATION_ID
  ) {
    throw new TypeError("Sensitive reveals are restricted to the main application");
  }

  const chainTicker = snapshotOptionalString(rawRequest.chainTicker, "chain ticker", 128);
  const address = snapshotOptionalString(rawRequest.address, "address", 512);
  const profile = snapshotOptionalString(rawRequest.profile, "profile", 512);

  if (policy.kind === "private-key" && source !== "eth" && source !== "erc20" && !chainTicker) {
    throw new TypeError("A chain ticker is required");
  }
  if (source === "native" && !address) throw new TypeError("An address is required");
  if (policy.kind === "seed" && !profile) throw new TypeError("A profile is required");

  return Object.freeze({
    kind: policy.kind,
    source,
    sourceLabel: policy.label,
    chainTicker,
    address,
    profile,
  });
};

const displayValue = (value) => escapeInvisibleCharacters(value);

const formatRequestDetail = (request) => {
  if (request.kind === "seed") {
    return [
      `Profile: ${displayValue(request.profile)}`,
      "",
      "The decrypted seed controls the Lite wallets in this profile. Approve only if you personally initiated this profile unlock.",
    ].join("\n");
  }

  const fields = [`Wallet mode: ${request.sourceLabel}`];
  if (request.chainTicker) fields.push(`Chain: ${displayValue(request.chainTicker)}`);
  if (request.address) fields.push(`Address: ${displayValue(request.address)}`);
  fields.push(
    "",
    "Anyone with this private key can control its funds. Approve only if you personally selected Copy Private Key or Reveal Private Key for the details shown above."
  );
  return fields.join("\n");
};

/**
 * Creates the main-process gate for raw private-key and seed responses.
 *
 * Approval and secret retrieval are a single operation. The renderer never
 * receives an approval token, and the backend-supplied executor runs at most
 * once after the trusted dialog has been accepted.
 */
const createSensitiveDataApprovalService = (dependencies = {}) => {
  const {
    dialog,
    getParentWindow,
    captureExecutionTarget = () => null,
    executionTargetMatches = () => true,
    createOperationId = () => randomBytes(12).toString("hex"),
    audit = () => {},
    now = () => Date.now(),
    minPromptIntervalMs = DEFAULT_MIN_PROMPT_INTERVAL_MS,
    maxPromptsPerWindow = DEFAULT_MAX_PROMPTS_PER_WINDOW,
    promptWindowMs = DEFAULT_PROMPT_WINDOW_MS,
  } = dependencies;

  if (dialog == null || typeof dialog.showMessageBox !== "function") {
    throw new TypeError("A dialog dependency is required");
  }
  if (typeof getParentWindow !== "function") {
    throw new TypeError("getParentWindow must be a function");
  }
  if (
    typeof captureExecutionTarget !== "function" ||
    typeof executionTargetMatches !== "function"
  ) {
    throw new TypeError("Execution-target dependencies must be functions");
  }

  let revealActive = false;
  const promptTimes = [];

  const auditSafe = (event) => {
    try {
      audit(Object.freeze({ ...event }));
    } catch (error) {
      // An audit failure must not disclose a secret or make a completed
      // reveal appear retryable.
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

  const execute = async (rawRequest, reveal) => {
    let request;
    try {
      request = createSensitiveRevealRequest(rawRequest);
    } catch (error) {
      return fixedError("INVALID_REQUEST", "Invalid sensitive-data reveal request.");
    }
    if (typeof reveal !== "function") {
      return fixedError("INVALID_REQUEST", "Invalid sensitive-data reveal operation.");
    }
    if (revealActive) {
      auditSafe({ kind: request.kind, source: request.source, outcome: "busy" });
      return fixedError("BUSY", "Another sensitive-data request is awaiting approval.");
    }

    revealActive = true;
    let operationId;
    let result;
    let executionTarget;

    try {
      operationId = createOperationId();
      if (typeof operationId !== "string" || operationId.length === 0) {
        auditSafe({ kind: request.kind, source: request.source, outcome: "operation-id-failed" });
        return fixedError("INTERNAL_ERROR", "Sensitive-data authorization failed closed.");
      }

      const parentWindow = getParentWindow();
      if (!isInteractiveWindow(parentWindow)) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "window-unavailable" });
        return fixedError(
          "WINDOW_UNAVAILABLE",
          "Focus the Verus Desktop window before revealing sensitive data."
        );
      }
      if (!checkAndRecordPromptRate()) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "rate-limited" });
        return fixedError("RATE_LIMITED", "Too many sensitive-data prompts. Wait and try again.");
      }
      try {
        executionTarget = captureExecutionTarget(request);
      } catch (error) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "target-unavailable" });
        return fixedError("TARGET_UNAVAILABLE", "Unable to bind the sensitive-data source.");
      }

      let confirmation;
      try {
        confirmation = await dialog.showMessageBox(parentWindow, {
          type: "warning",
          title: request.kind === "seed" ? "Authorize Seed Unlock" : "Authorize Private-Key Reveal",
          message: request.kind === "seed"
            ? "Verus Desktop is requesting access to this profile's decrypted seed."
            : "Verus Desktop is requesting a one-time raw private-key reveal.",
          detail: formatRequestDetail(request),
          buttons: ["Cancel", request.kind === "seed" ? "Unlock Once" : "Reveal Once"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      } catch (error) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "dialog-error" });
        return fixedError("DIALOG_FAILED", "Unable to obtain native sensitive-data authorization.");
      }

      if (confirmation == null || confirmation.response !== 1) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "cancelled" });
        return { status: "cancelled" };
      }
      if (getParentWindow() !== parentWindow || !isAvailableWindow(parentWindow)) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "window-lost" });
        return fixedError("WINDOW_UNAVAILABLE", "The trusted application window is no longer available.");
      }
      try {
        if (!executionTargetMatches(request, executionTarget)) {
          auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "target-changed" });
          return fixedError(
            "TARGET_CHANGED",
            "The approved sensitive-data source changed; nothing was revealed."
          );
        }
      } catch (error) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "target-unavailable" });
        return fixedError("TARGET_UNAVAILABLE", "Unable to verify the sensitive-data source.");
      }

      auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "approved" });
      try {
        result = await reveal(request, executionTarget);
      } catch (error) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "reveal-failed" });
        return fixedError("REVEAL_FAILED", "The sensitive data could not be revealed.");
      }

      if (typeof result !== "string" || result.length === 0 || result.length > MAX_SECRET_LENGTH) {
        auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "invalid-result" });
        return fixedError("INVALID_RESULT", "The sensitive-data source returned an invalid result.");
      }

      auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "completed" });
      return { status: "ok", result };
    } catch (error) {
      auditSafe({ operationId, kind: request.kind, source: request.source, outcome: "internal-error" });
      return fixedError("INTERNAL_ERROR", "Sensitive-data authorization failed closed.");
    } finally {
      result = null;
      executionTarget = null;
      request = null;
      revealActive = false;
    }
  };

  return Object.freeze({
    execute,
    isBusy: () => revealActive,
  });
};

const executeSensitiveReveal = async (api, req, details, reveal) => {
  if (
    !api.sensitiveDataApproval ||
    typeof api.sensitiveDataApproval.execute !== "function"
  ) {
    return {
      msg: "error",
      result: "Native sensitive-data authorization is unavailable; nothing was revealed.",
    };
  }

  let outcome;
  try {
    outcome = await api.sensitiveDataApproval.execute(
      Object.freeze({
        ...details,
        callerAppId: req && req.api_header && req.api_header.app_id,
        callerBuiltin: req && req.api_header && req.api_header.builtin,
      }),
      reveal
    );
  } catch (error) {
    return {
      msg: "error",
      result: "Native sensitive-data authorization failed; nothing was revealed.",
    };
  }

  if (outcome && outcome.status === "ok") {
    return { msg: "success", result: outcome.result };
  }
  if (outcome && outcome.status === "cancelled") {
    return { msg: "error", result: "Sensitive-data reveal cancelled." };
  }
  return {
    msg: "error",
    result: outcome && typeof outcome.message === "string"
      ? outcome.message
      : "Sensitive-data authorization failed; nothing was revealed.",
  };
};

module.exports = {
  MAIN_APPLICATION_ID,
  createSensitiveDataApprovalService,
  createSensitiveRevealRequest,
  executeSensitiveReveal,
  formatRequestDetail,
};
