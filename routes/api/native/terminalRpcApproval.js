"use strict";

const { randomBytes } = require("crypto");
const fs = require("fs");
const path = require("path");
const { fsyncDirectoryBestEffort } = require("../utils/atomicFile");
const {
  classifyTerminalRpcMethod,
  createTerminalRpcRequest,
  escapeInvisibleCharacters,
  formatTerminalRpcRequest,
} = require("./terminalRpcSecurity");

const DEFAULT_MAX_SENSITIVE_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MIN_PROMPT_INTERVAL_MS = 1500;
const DEFAULT_MAX_PROMPTS_PER_WINDOW = 5;
const DEFAULT_PROMPT_WINDOW_MS = 60 * 1000;
const MAX_DAEMON_FAILURE_DETAIL_BYTES = 8 * 1024;

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

const serializeSensitiveOutput = (result, maxBytes) => {
  let output;

  if (Buffer.isBuffer(result)) {
    output = Buffer.from(result);
  } else if (typeof result === "string") {
    output = Buffer.from(`${result}\n`, "utf8");
  } else {
    const serialized = JSON.stringify(result, null, 2);
    if (serialized == null) throw new Error("Sensitive RPC result is not serializable");
    output = Buffer.from(`${serialized}\n`, "utf8");
  }

  if (output.length > maxBytes) throw new Error("Sensitive RPC result is too large");
  return output;
};

const defaultSaveName = (request, now) => {
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
  return `${request.chainTicker}-${request.method}-${stamp}.txt`;
};

const truncateUtf8 = (value, maxBytes) => {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

  let bytes = 0;
  let truncated = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    truncated += character;
    bytes += characterBytes;
  }
  return `${truncated}\n[truncated]`;
};

const formatDaemonFailure = (error) => {
  const rawCode = error && error.code;
  const code =
    (typeof rawCode === "number" && Number.isFinite(rawCode)) ||
    (typeof rawCode === "string" && rawCode.length <= 64)
      ? escapeInvisibleCharacters(String(rawCode))
      : "unknown";
  const rawMessage =
    error && typeof error.message === "string" && error.message.length > 0
      ? error.message
      : "The daemon returned an error without a message.";
  const message = truncateUtf8(
    escapeInvisibleCharacters(rawMessage.slice(0, MAX_DAEMON_FAILURE_DETAIL_BYTES * 2)),
    MAX_DAEMON_FAILURE_DETAIL_BYTES
  );
  return `RPC error ${code}\n\n${message}`;
};

const isConfirmedDaemonFailure = (error) =>
  error != null &&
  typeof error === "object" &&
  Object.prototype.hasOwnProperty.call(error, "confirmedDaemonResponse") &&
  error.confirmedDaemonResponse === true;

/**
 * Builds the privileged GUI-terminal RPC gate without importing Electron.
 *
 * The caller supplies Electron's dialog object, a dynamic parent-window
 * getter, and the daemon executor. Approval and execution remain one backend
 * operation; no reusable approval token or sensitive response is exposed.
 */
const createTerminalRpcApprovalService = (dependencies = {}) => {
  const {
    dialog,
    getParentWindow,
    executeRpc,
    captureExecutionTarget = () => null,
    executionTargetMatches = (request, capturedTarget) =>
      Object.is(captureExecutionTarget(request), capturedTarget),
    classifyMethod = classifyTerminalRpcMethod,
    formatRequest = formatTerminalRpcRequest,
    fsApi = fs,
    pathApi = path,
    createOperationId = () => randomBytes(12).toString("hex"),
    audit = () => {},
    now = () => Date.now(),
    maxSensitiveOutputBytes = DEFAULT_MAX_SENSITIVE_OUTPUT_BYTES,
    minPromptIntervalMs = DEFAULT_MIN_PROMPT_INTERVAL_MS,
    maxPromptsPerWindow = DEFAULT_MAX_PROMPTS_PER_WINDOW,
    promptWindowMs = DEFAULT_PROMPT_WINDOW_MS,
  } = dependencies;

  if (
    dialog == null ||
    typeof dialog.showMessageBox !== "function" ||
    typeof dialog.showSaveDialog !== "function"
  ) {
    throw new TypeError("A dialog dependency with message and save dialogs is required");
  }
  if (typeof getParentWindow !== "function") {
    throw new TypeError("getParentWindow must be a function");
  }
  if (typeof executeRpc !== "function") throw new TypeError("executeRpc must be a function");
  if (typeof captureExecutionTarget !== "function") {
    throw new TypeError("captureExecutionTarget must be a function");
  }
  if (typeof executionTargetMatches !== "function") {
    throw new TypeError("executionTargetMatches must be a function");
  }
  if (typeof classifyMethod !== "function" || typeof formatRequest !== "function") {
    throw new TypeError("RPC policy dependencies must be functions");
  }
  let privilegedRequestActive = false;
  const promptTimes = [];

  const auditSafe = (event) => {
    try {
      audit(Object.freeze({ ...event }));
    } catch (error) {
      // Audit failures must not disclose data or make an executed RPC appear
      // retryable.
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

  const validateDestination = (destination) => {
    const parentDirectory = pathApi.dirname(destination);
    const parentStat = fsApi.lstatSync(parentDirectory);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || fsApi.existsSync(destination)) {
      throw new Error("Unsafe or occupied save destination");
    }
  };

  const reservationMatchesDestination = (reservation) => {
    try {
      const destinationStat = fsApi.lstatSync(reservation.destination);
      return (
        !destinationStat.isSymbolicLink() &&
        destinationStat.isFile() &&
        destinationStat.dev === reservation.dev &&
        destinationStat.ino === reservation.ino
      );
    } catch (error) {
      return false;
    }
  };

  const reserveSensitiveDestination = (destination) => {
    // Keep a reserved POSIX destination unreadable until the complete output
    // has been written, synced, and verified. Windows does not implement Unix
    // permission bits equivalently, so its final protection follows the
    // selected filesystem/ACLs and the warning shown to the user.
    const reservationMode = process.platform === "win32" ? 0o600 : 0o000;
    const fd = fsApi.openSync(destination, "wx+", reservationMode);
    try {
      fsApi.fchmodSync(fd, reservationMode);
      const stat = fsApi.fstatSync(fd);
      return { destination, fd, dev: stat.dev, ino: stat.ino };
    } catch (error) {
      try { fsApi.closeSync(fd); } catch (cleanupError) {}
      try { fsApi.unlinkSync(destination); } catch (cleanupError) {}
      throw error;
    }
  };

  const releaseSensitiveReservation = (reservation, remove) => {
    if (!reservation) return;
    try { fsApi.closeSync(reservation.fd); } catch (error) {}
    if (remove && reservationMatchesDestination(reservation)) {
      try { fsApi.unlinkSync(reservation.destination); } catch (error) {}
    }
  };

  const commitSensitiveReservation = (reservation, output) => {
    if (!reservationMatchesDestination(reservation)) {
      throw new Error("Reserved destination was replaced");
    }
    fsApi.ftruncateSync(reservation.fd, 0);
    fsApi.writeFileSync(reservation.fd, output);
    fsApi.fsyncSync(reservation.fd);

    const persisted = Buffer.alloc(output.length);
    let offset = 0;
    while (offset < persisted.length) {
      const bytesRead = fsApi.readSync(
        reservation.fd,
        persisted,
        offset,
        persisted.length - offset,
        offset
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== output.length || !persisted.equals(output)) {
      persisted.fill(0);
      throw new Error("Sensitive output verification failed");
    }
    persisted.fill(0);
    if (!reservationMatchesDestination(reservation)) {
      throw new Error("Reserved destination changed while saving");
    }

    fsApi.fchmodSync(reservation.fd, 0o600);
    fsApi.fsyncSync(reservation.fd);

    fsApi.closeSync(reservation.fd);
    reservation.fd = null;
    fsyncDirectoryBestEffort(pathApi.dirname(reservation.destination));
  };

  const selectSensitiveDestination = async (parentWindow, request) => {
    const selection = await dialog.showSaveDialog(parentWindow, {
      title: "Save Sensitive Daemon Output",
      buttonLabel: "Save",
      defaultPath: defaultSaveName(request, now),
      filters: [{ name: "Text files", extensions: ["txt"] }],
      properties: ["createDirectory", "showOverwriteConfirmation", "dontAddToRecent"],
    });

    if (selection == null || selection.canceled === true || !selection.filePath) return null;
    if (
      typeof selection.filePath !== "string" ||
      selection.filePath.length === 0 ||
      selection.filePath.length > 4096 ||
      selection.filePath.includes("\0") ||
      !pathApi.isAbsolute(selection.filePath)
    ) {
      throw new Error("Invalid save destination");
    }

    let selectedPath = pathApi.resolve(selection.filePath);
    const extension = pathApi.extname(selectedPath);
    if (extension === "") selectedPath = `${selectedPath}.txt`;
    else if (extension.toLowerCase() !== ".txt") throw new Error("Sensitive output must be a text file");

    const realParent = fsApi.realpathSync(pathApi.dirname(selectedPath));
    const destination = pathApi.join(realParent, pathApi.basename(selectedPath));
    validateDestination(destination);
    return destination;
  };

  const snapshotRequest = (rawRequest) => createTerminalRpcRequest({
    chainTicker: rawRequest && rawRequest.chainTicker,
    cmd: rawRequest && rawRequest.method,
    params: rawRequest && rawRequest.params,
  });

  const execute = async (rawRequest) => {
    let request;
    let policy;
    try {
      request = snapshotRequest(rawRequest);
      policy = classifyMethod(request.method);
    } catch (error) {
      return fixedError("INVALID_REQUEST", "Invalid terminal RPC request.");
    }

    if (policy.kind === "read-only") {
      try {
        return { status: "ok", result: await executeRpc(request) };
      } catch (error) {
        return fixedError("RPC_FAILED", "Daemon RPC failed.");
      }
    }
    if (privilegedRequestActive) {
      auditSafe({ chain: request.chainTicker, method: request.method, outcome: "busy" });
      return fixedError("BUSY", "Another privileged terminal command is awaiting approval.");
    }

    privilegedRequestActive = true;
    let operationId;
    let destination = null;
    let destinationReservation = null;
    let executionTarget;

    try {
      operationId = createOperationId();
      if (typeof operationId !== "string" || operationId.length === 0) {
        auditSafe({ chain: request.chainTicker, method: request.method, outcome: "operation-id-failed" });
        return fixedError("INTERNAL_ERROR", "Privileged terminal command failed closed.");
      }

      const parentWindow = getParentWindow();
      if (!isInteractiveWindow(parentWindow)) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "window-unavailable" });
        return fixedError("WINDOW_UNAVAILABLE", "Focus the Verus Desktop window before running this command.");
      }
      if (!checkAndRecordPromptRate()) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "rate-limited" });
        return fixedError("RATE_LIMITED", "Too many terminal approval prompts. Wait and try again.");
      }
      try {
        executionTarget = captureExecutionTarget(request);
      } catch (error) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "target-unavailable" });
        return fixedError("TARGET_UNAVAILABLE", "Unable to bind this command to a daemon target.");
      }

      const sensitiveOutput = policy.kind === "sensitive-output";
      const highRiskWarning = policy.highRisk
        ? "\n\nThis command can spend or sign funds, or use wallet authority. Do not approve unless you personally initiated this exact command."
        : "";
      const sensitiveWarning = sensitiveOutput
        ? "\n\nThis command can return private keys, passphrases, viewing keys, decrypted data, or other private material. Its output will never be shown in the application; after approval, you must choose a new .txt file. The file is unencrypted and inherits relevant access controls from the selected filesystem and folder. Anyone who can read it may gain access to private data or funds, so choose a secure local location and never share it."
        : "";
      const sensitiveFileWarning = policy.sensitiveFileSideEffect === true
        ? "\n\nThis command tells the daemon to write an unencrypted wallet or private-key file to the destination shown in Parameters. That daemon-written file is not controlled by the native output picker. Verify the destination carefully and never share the file."
        : "";

      let requestForDisplay;
      try {
        requestForDisplay = formatRequest(request);
      } catch (error) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "display-failed" });
        return fixedError("DISPLAY_FAILED", "Unable to display this command safely.");
      }

      let confirmation;
      try {
        confirmation = await dialog.showMessageBox(parentWindow, {
          type: "warning",
          title: highRiskWarning ? "Confirm Funds or Wallet-Authority Command" : "Confirm Daemon Command",
          message:
            `This daemon command is not read-only. Running it once may change wallet or node state.${highRiskWarning}${sensitiveWarning}${sensitiveFileWarning}`,
          detail:
            "Review the backend-decoded request below. Secret-valued parameters are redacted in this trusted dialog; the backend will execute the frozen original exactly once.\n\n" +
            requestForDisplay,
          buttons: ["Cancel", sensitiveOutput ? "Choose Save Location…" : "Run Once"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      } catch (error) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "dialog-error" });
        return fixedError("DIALOG_FAILED", "Unable to obtain terminal command approval.");
      }

      if (confirmation == null || confirmation.response !== 1) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "approval-cancelled" });
        return { status: "cancelled", stage: "approval" };
      }
      if (getParentWindow() !== parentWindow || !isAvailableWindow(parentWindow)) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "window-lost-after-approval" });
        return fixedError("WINDOW_UNAVAILABLE", "The trusted application window is no longer available.");
      }
      try {
        if (!executionTargetMatches(request, executionTarget)) {
          auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "target-changed" });
          return fixedError("TARGET_CHANGED", "The daemon target changed while awaiting approval.");
        }
      } catch (error) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "target-unavailable" });
        return fixedError("TARGET_UNAVAILABLE", "Unable to verify the approved daemon target.");
      }

      if (sensitiveOutput) {
        try {
          destination = await selectSensitiveDestination(parentWindow, request);
        } catch (error) {
          auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "save-selection-failed" });
          return fixedError("SAVE_DESTINATION_INVALID", "Unable to use the selected save destination.");
        }
        if (destination == null) {
          auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "save-cancelled" });
          return { status: "cancelled", stage: "save" };
        }
        if (getParentWindow() !== parentWindow || !isAvailableWindow(parentWindow)) {
          auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "window-lost-after-save-selection" });
          return fixedError("WINDOW_UNAVAILABLE", "The trusted application window is no longer available.");
        }
        try {
          validateDestination(destination);
        } catch (error) {
          auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "save-destination-changed" });
          return fixedError("SAVE_DESTINATION_CHANGED", "The save destination changed before execution.");
        }
        try {
          if (!executionTargetMatches(request, executionTarget)) {
            auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "target-changed" });
            return fixedError("TARGET_CHANGED", "The daemon target changed before execution.");
          }
        } catch (error) {
          auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "target-unavailable" });
          return fixedError("TARGET_UNAVAILABLE", "Unable to verify the approved daemon target.");
        }
        try {
          destinationReservation = reserveSensitiveDestination(destination);
        } catch (error) {
          auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "save-reservation-failed" });
          return fixedError("SAVE_DESTINATION_CHANGED", "Unable to reserve the selected save destination.");
        }
      }

      auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "approved" });

      let result;
      try {
        result = await executeRpc(request, executionTarget);
      } catch (error) {
        if (sensitiveOutput && isConfirmedDaemonFailure(error)) {
          // Remove the reserved placeholder before displaying the failure. The
          // raw daemon message remains in this trusted native dialog and never
          // becomes part of the renderer response or audit log.
          releaseSensitiveReservation(destinationReservation, true);
          destinationReservation = null;
          destination = null;

          const failureDetail = formatDaemonFailure(error);
          let alertShown = false;
          if (getParentWindow() === parentWindow && isAvailableWindow(parentWindow)) {
            try {
              await dialog.showMessageBox(parentWindow, {
                type: "error",
                title: "Daemon RPC Failed",
                message: "The daemon command failed. No output was saved.",
                detail: failureDetail,
                buttons: ["OK"],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
              alertShown = true;
            } catch (dialogError) {
              // The renderer still receives only the fixed RPC_FAILED status.
            }
          }
          auditSafe({
            operationId,
            chain: request.chainTicker,
            method: request.method,
            outcome: alertShown ? "rpc-rejected-alerted" : "rpc-rejected-alert-failed",
          });
          return fixedError("RPC_FAILED", "Daemon RPC failed.");
        }

        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "rpc-failed" });
        return fixedError(
          "RPC_OUTCOME_UNKNOWN",
          "The daemon did not return a confirmed result. The command may have executed; verify before retrying."
        );
      }

      if (!sensitiveOutput) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "completed" });
        return { status: "ok", result };
      }

      let output;
      try {
        output = serializeSensitiveOutput(result, maxSensitiveOutputBytes);
        commitSensitiveReservation(destinationReservation, output);
        destinationReservation = null;
        auditSafe({
          operationId,
          chain: request.chainTicker,
          method: request.method,
          outcome: "saved",
          bytes: output.length,
        });
        return { status: "saved" };
      } catch (error) {
        auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "save-failed" });
        return fixedError("SAVE_FAILED", "Sensitive daemon output could not be saved.");
      } finally {
        if (Buffer.isBuffer(output)) output.fill(0);
        result = null;
      }
    } catch (error) {
      auditSafe({ operationId, chain: request.chainTicker, method: request.method, outcome: "internal-error" });
      return fixedError("INTERNAL_ERROR", "Privileged terminal command failed closed.");
    } finally {
      destination = null;
      releaseSensitiveReservation(destinationReservation, true);
      destinationReservation = null;
      executionTarget = null;
      privilegedRequestActive = false;
    }
  };

  return Object.freeze({
    execute,
    isBusy: () => privilegedRequestActive,
  });
};

module.exports = {
  createTerminalRpcApprovalService,
  isAvailableWindow,
  serializeSensitiveOutput,
};
