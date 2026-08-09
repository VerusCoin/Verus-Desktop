"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");
const RpcError = require("../routes/api/utils/rpc/rpcError");
const {
  createTerminalRpcApprovalService,
} = require("../routes/api/native/terminalRpcApproval");

const usableWindow = (overrides = {}) => ({
  isDestroyed: () => false,
  isVisible: () => true,
  isFocused: () => true,
  webContents: { isDestroyed: () => false },
  ...overrides,
});

const approvedDialog = (overrides = {}) => ({
  showSaveDialog: async () => ({ canceled: true }),
  showMessageBox: async () => ({ response: 1 }),
  ...overrides,
});

const confirmedDaemonError = (code, message) => {
  const error = new RpcError(code, message);
  Object.defineProperty(error, "confirmedDaemonResponse", {
    enumerable: false,
    value: true,
  });
  return error;
};

describe("terminal RPC approval service", function () {
  it("shows the exact decoded request in a parent-bound warning and executes an immutable snapshot once", async function () {
    const parentWindow = usableWindow();
    const original = {
      chainTicker: "VRSC",
      method: "sendcurrency",
      params: [{ amount: 1, recipients: ["RExample"] }],
    };
    let executedRequest;
    let executionCount = 0;

    const service = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showMessageBox: async (parent, options) => {
          assert.strictEqual(parent, parentWindow);
          assert.strictEqual(options.type, "warning");
          assert.strictEqual(options.defaultId, 0);
          assert.strictEqual(options.cancelId, 0);
          assert.deepStrictEqual(options.buttons, ["Cancel", "Run Once"]);
          assert.match(options.message, /can spend or sign funds/i);
          assert.match(options.message, /personally initiated this exact command/i);
          assert.match(options.detail, /"chain": "VRSC"/);
          assert.match(options.detail, /"method": "sendcurrency"/);
          assert.match(options.detail, /"amount": 1/);
          assert.match(options.detail, /RExample/);

          original.params[0].amount = 999;
          original.params[0].recipients.push("RAttacker");
          return { response: 1 };
        },
      }),
      getParentWindow: () => parentWindow,
      executeRpc: async (request) => {
        executionCount += 1;
        executedRequest = request;
        return { txid: "abc" };
      },
      createOperationId: () => "operation-1",
    });

    const response = await service.execute(original);

    assert.strictEqual(executionCount, 1);
    assert.strictEqual(executedRequest.chainTicker, "VRSC");
    assert.strictEqual(executedRequest.method, "sendcurrency");
    assert.deepStrictEqual(executedRequest.params, [
      { amount: 1, recipients: ["RExample"] },
    ]);
    assert.strictEqual(Object.isFrozen(executedRequest), true);
    assert.strictEqual(Object.isFrozen(executedRequest.params), true);
    assert.strictEqual(Object.isFrozen(executedRequest.params[0]), true);
    assert.strictEqual(Object.isFrozen(executedRequest.params[0].recipients), true);
    assert.deepStrictEqual(response, { status: "ok", result: { txid: "abc" } });
  });

  it("redacts secret-valued parameters from the native prompt without changing execution", async function () {
    const parentWindow = usableWindow();
    const passphrase = "correct horse battery staple";
    let executedPassphrase;

    const service = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showMessageBox: async (parent, options) => {
          assert.strictEqual(parent, parentWindow);
          assert.doesNotMatch(options.detail, new RegExp(passphrase));
          assert.match(options.detail, /REDACTED: secret parameter/);
          return { response: 1 };
        },
      }),
      getParentWindow: () => parentWindow,
      executeRpc: async (request) => {
        executedPassphrase = request.params[0];
        return null;
      },
      createOperationId: () => "operation-redaction",
    });

    const response = await service.execute({
      chainTicker: "VRSC",
      method: "walletpassphrase",
      params: [passphrase, 30],
    });

    assert.strictEqual(executedPassphrase, passphrase);
    assert.deepStrictEqual(response, { status: "ok", result: null });
  });

  it("confirms, reserves a new file, and saves sensitive output without returning it", async function () {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verus-rpc-approval-"));
    const destination = path.join(temporaryRoot, "private-key.txt");
    const parentWindow = usableWindow();
    const order = [];
    const auditEvents = [];
    const secret = "super-secret-private-key";

    try {
      const service = createTerminalRpcApprovalService({
        dialog: approvedDialog({
          showMessageBox: async (parent, options) => {
            assert.strictEqual(parent, parentWindow);
            assert.deepStrictEqual(options.buttons, ["Cancel", "Choose Save Location…"]);
            assert.match(options.message, /never be shown in the application/i);
            assert.match(options.message, /file is unencrypted/i);
            assert.match(options.message, /can spend or sign funds/i);
            assert.doesNotMatch(options.detail, /wallet passphrase value/);
            order.push("approval");
            return { response: 1 };
          },
          showSaveDialog: async (parent, options) => {
            assert.strictEqual(parent, parentWindow);
            assert.match(options.defaultPath, /VRSC-convertpassphrase-.*\.txt$/);
            assert.deepStrictEqual(options.filters, [{ name: "Text files", extensions: ["txt"] }]);
            order.push("save-selection");
            return { canceled: false, filePath: destination };
          },
        }),
        getParentWindow: () => parentWindow,
        executeRpc: async () => {
          assert.strictEqual(fs.existsSync(destination), true);
          assert.strictEqual(fs.statSync(destination).size, 0);
          order.push("execute");
          return { privkey: secret, passphrase: "wallet passphrase value" };
        },
        createOperationId: () => "operation-save",
        audit: (event) => auditEvents.push(event),
      });

      const response = await service.execute({
        chainTicker: "VRSC",
        method: "convertpassphrase",
        params: ["wallet passphrase value"],
      });

      assert.deepStrictEqual(order, ["approval", "save-selection", "execute"]);
      assert.deepStrictEqual(response, { status: "saved" });
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(destination, "utf8")), {
        privkey: secret,
        passphrase: "wallet passphrase value",
      });
      if (process.platform !== "win32") {
        assert.strictEqual(fs.statSync(destination).mode & 0o777, 0o600);
      }

      assert.doesNotMatch(JSON.stringify(response), /super-secret|private-key\.txt|verus-rpc-approval/);
      assert.doesNotMatch(JSON.stringify(auditEvents), /super-secret|private-key\.txt|verus-rpc-approval/);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("shows a confirmed sensitive RPC failure only in a native alert and removes the empty file first", async function () {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verus-rpc-failure-"));
    const destination = path.join(temporaryRoot, "unused-private-key.txt");
    const parentWindow = usableWindow();
    const daemonMessage = "Invalid or non-wallet address\nretry \u202elater";
    const order = [];
    const auditEvents = [];
    let service;

    try {
      service = createTerminalRpcApprovalService({
        dialog: approvedDialog({
          showMessageBox: async (parent, options) => {
            assert.strictEqual(parent, parentWindow);
            if (options.type === "warning") {
              order.push("approval");
              return { response: 1 };
            }

            order.push("failure-alert");
            assert.strictEqual(options.type, "error");
            assert.strictEqual(options.title, "Daemon RPC Failed");
            assert.match(options.message, /No output was saved/i);
            assert.deepStrictEqual(options.buttons, ["OK"]);
            assert.strictEqual(options.defaultId, 0);
            assert.strictEqual(options.cancelId, 0);
            assert.strictEqual(options.noLink, true);
            assert.match(options.detail, /RPC error -5/);
            assert.match(options.detail, /Invalid or non-wallet address/);
            assert.match(options.detail, /\\u000a/);
            assert.match(options.detail, /\\u202e/);
            assert.doesNotMatch(options.detail, /\u202e/);
            assert.strictEqual(fs.existsSync(destination), false);
            assert.strictEqual(service.isBusy(), true);
            return { response: 0 };
          },
          showSaveDialog: async () => {
            order.push("save-selection");
            return { canceled: false, filePath: destination };
          },
        }),
        getParentWindow: () => parentWindow,
        executeRpc: async () => {
          order.push("execute");
          assert.strictEqual(fs.existsSync(destination), true);
          throw confirmedDaemonError(-5, daemonMessage);
        },
        createOperationId: () => "operation-rpc-failure",
        audit: (event) => auditEvents.push(event),
      });

      const response = await service.execute({
        chainTicker: "VRSC",
        method: "dumpprivkey",
        params: ["RNotInWallet"],
      });

      assert.deepStrictEqual(order, ["approval", "save-selection", "execute", "failure-alert"]);
      assert.deepStrictEqual(response, {
        status: "error",
        code: "RPC_FAILED",
        message: "Daemon RPC failed.",
      });
      assert.strictEqual(fs.existsSync(destination), false);
      assert.strictEqual(service.isBusy(), false);
      assert.doesNotMatch(JSON.stringify(response), /Invalid or non-wallet|unused-private-key|verus-rpc-failure/);
      assert.doesNotMatch(JSON.stringify(auditEvents), /Invalid or non-wallet|unused-private-key|verus-rpc-failure/);
      assert.match(JSON.stringify(auditEvents), /rpc-rejected-alerted/);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps ambiguous sensitive transport failures out of native daemon-error alerts", async function () {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verus-rpc-transport-"));
    const destination = path.join(temporaryRoot, "unused.txt");
    const parentWindow = usableWindow();
    let messageBoxes = 0;

    try {
      const service = createTerminalRpcApprovalService({
        dialog: approvedDialog({
          showMessageBox: async () => {
            messageBoxes += 1;
            return { response: 1 };
          },
          showSaveDialog: async () => ({ canceled: false, filePath: destination }),
        }),
        getParentWindow: () => parentWindow,
        executeRpc: async () => { throw new Error("socket closed after dispatch"); },
      });

      const response = await service.execute({
        chainTicker: "VRSC",
        method: "dumpprivkey",
        params: ["RAddress"],
      });

      assert.strictEqual(messageBoxes, 1);
      assert.strictEqual(response.code, "RPC_OUTCOME_UNKNOWN");
      assert.doesNotMatch(JSON.stringify(response), /socket closed/);
      assert.strictEqual(fs.existsSync(destination), false);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("executes an unknown future method only through strongest-warning save-only handling", async function () {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verus-rpc-future-"));
    const destination = path.join(temporaryRoot, "future-output.txt");
    const parentWindow = usableWindow();
    const order = [];
    let executions = 0;

    try {
      const service = createTerminalRpcApprovalService({
        dialog: approvedDialog({
          showMessageBox: async (parent, options) => {
            assert.strictEqual(parent, parentWindow);
            assert.match(options.message, /can spend or sign funds/i);
            assert.deepStrictEqual(options.buttons, ["Cancel", "Choose Save Location…"]);
            order.push("approval");
            return { response: 1 };
          },
          showSaveDialog: async () => {
            order.push("save-selection");
            return { canceled: false, filePath: destination };
          },
        }),
        getParentWindow: () => parentWindow,
        executeRpc: async () => {
          executions += 1;
          order.push("execute");
          return "future-secret-result";
        },
      });

      const response = await service.execute({
        chainTicker: "VRSC",
        method: "future_wallet_rpc",
        params: [{ exact: "argument" }],
      });
      assert.deepStrictEqual(order, ["approval", "save-selection", "execute"]);
      assert.strictEqual(executions, 1);
      assert.deepStrictEqual(response, { status: "saved" });
      assert.strictEqual(fs.readFileSync(destination, "utf8"), "future-secret-result\n");
      assert.doesNotMatch(JSON.stringify(response), /future-secret|future-output|verus-rpc-future/);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("does not execute when approval or sensitive save selection is cancelled", async function () {
    const parentWindow = usableWindow();
    let executions = 0;
    let saveSelections = 0;

    const approvalCancelled = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showMessageBox: async () => ({ response: 0 }),
        showSaveDialog: async () => { saveSelections += 1; return { canceled: false }; },
      }),
      getParentWindow: () => parentWindow,
      executeRpc: async () => { executions += 1; },
    });
    assert.deepStrictEqual(
      await approvalCancelled.execute({ chainTicker: "VRSC", method: "dumpprivkey", params: [] }),
      { status: "cancelled", stage: "approval" }
    );

    const saveCancelled = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showSaveDialog: async () => { saveSelections += 1; return { canceled: true }; },
      }),
      getParentWindow: () => parentWindow,
      executeRpc: async () => { executions += 1; },
    });
    assert.deepStrictEqual(
      await saveCancelled.execute({ chainTicker: "VRSC", method: "dumpprivkey", params: [] }),
      { status: "cancelled", stage: "save" }
    );

    assert.strictEqual(executions, 0);
    assert.strictEqual(saveSelections, 1);
  });

  it("rejects concurrent and rapid privileged requests instead of queueing prompts", async function () {
    const parentWindow = usableWindow();
    let finishPrompt;
    let promptCount = 0;
    let currentTime = 10000;
    const promptPending = new Promise((resolve) => { finishPrompt = resolve; });

    const service = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showMessageBox: async () => {
          promptCount += 1;
          if (promptCount === 1) return promptPending;
          return { response: 0 };
        },
      }),
      getParentWindow: () => parentWindow,
      executeRpc: async () => "must not execute",
      createOperationId: () => "operation-active",
      now: () => currentTime,
    });

    const firstRequest = service.execute({ chainTicker: "VRSC", method: "stop", params: [] });
    assert.strictEqual(service.isBusy(), true);
    assert.strictEqual(
      (await service.execute({ chainTicker: "VRSC", method: "sendcurrency", params: [] })).code,
      "BUSY"
    );
    finishPrompt({ response: 0 });
    await firstRequest;

    assert.strictEqual(
      (await service.execute({ chainTicker: "VRSC", method: "stop", params: [] })).code,
      "RATE_LIMITED"
    );
    currentTime += 1500;
    assert.deepStrictEqual(
      await service.execute({ chainTicker: "VRSC", method: "stop", params: [] }),
      { status: "cancelled", stage: "approval" }
    );
    assert.strictEqual(promptCount, 2);
  });

  it("fails closed without a visible, focused, live parent or when the dialog fails", async function () {
    let executions = 0;
    const run = async (getParentWindow, dialog = approvedDialog()) => {
      const service = createTerminalRpcApprovalService({
        dialog,
        getParentWindow,
        executeRpc: async () => { executions += 1; },
      });
      return service.execute({ chainTicker: "VRSC", method: "stop", params: [] });
    };

    assert.strictEqual((await run(() => null)).code, "WINDOW_UNAVAILABLE");
    assert.strictEqual((await run(() => usableWindow({ isDestroyed: () => true }))).code, "WINDOW_UNAVAILABLE");
    assert.strictEqual((await run(() => usableWindow({ isVisible: () => false }))).code, "WINDOW_UNAVAILABLE");
    assert.strictEqual((await run(() => usableWindow({ isFocused: () => false }))).code, "WINDOW_UNAVAILABLE");
    assert.strictEqual((await run(
      usableWindow,
      approvedDialog({ showMessageBox: async () => { throw new Error("dialog failed"); } })
    )).code, "DIALOG_FAILED");
    assert.strictEqual(executions, 0);
  });

  it("does not execute when the daemon target changes during approval", async function () {
    const parentWindow = usableWindow();
    let target = "rpc-target-before";
    let executions = 0;
    const service = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showMessageBox: async () => {
          target = "rpc-target-after";
          return { response: 1 };
        },
      }),
      getParentWindow: () => parentWindow,
      captureExecutionTarget: () => target,
      executeRpc: async () => { executions += 1; },
    });

    const response = await service.execute({ chainTicker: "VRSC", method: "stop", params: [] });
    assert.strictEqual(response.code, "TARGET_CHANGED");
    assert.strictEqual(executions, 0);
  });

  it("fails closed if the parent disappears during approval or save selection rejects", async function () {
    let destroyed = false;
    const parentWindow = usableWindow({ isDestroyed: () => destroyed });
    let executions = 0;
    const destroyedService = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showMessageBox: async () => { destroyed = true; return { response: 1 }; },
      }),
      getParentWindow: () => parentWindow,
      executeRpc: async () => { executions += 1; },
    });
    assert.strictEqual(
      (await destroyedService.execute({ chainTicker: "VRSC", method: "stop", params: [] })).code,
      "WINDOW_UNAVAILABLE"
    );

    destroyed = false;
    const rejectingSaveService = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showSaveDialog: async () => { throw new Error("native save dialog failed"); },
      }),
      getParentWindow: () => parentWindow,
      executeRpc: async () => { executions += 1; },
    });
    assert.strictEqual(
      (await rejectingSaveService.execute({
        chainTicker: "VRSC",
        method: "dumpprivkey",
        params: [],
      })).code,
      "SAVE_DESTINATION_INVALID"
    );
    assert.strictEqual(executions, 0);
  });

  it("refuses an occupied or raced sensitive-output destination without overwriting it", async function () {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verus-rpc-existing-"));
    const destination = path.join(temporaryRoot, "existing.txt");
    const parentWindow = usableWindow();
    fs.writeFileSync(destination, "keep-me");
    let executions = 0;

    try {
      const occupiedService = createTerminalRpcApprovalService({
        dialog: approvedDialog({
          showSaveDialog: async () => ({ canceled: false, filePath: destination }),
        }),
        getParentWindow: () => parentWindow,
        executeRpc: async () => { executions += 1; return "secret"; },
      });
      const occupied = await occupiedService.execute({
        chainTicker: "VRSC",
        method: "dumpprivkey",
        params: [],
      });
      assert.strictEqual(occupied.code, "SAVE_DESTINATION_INVALID");
      assert.strictEqual(executions, 0);

      if (process.platform !== "win32") {
        fs.unlinkSync(destination);
        const racedService = createTerminalRpcApprovalService({
          dialog: approvedDialog({
            showSaveDialog: async () => ({ canceled: false, filePath: destination }),
          }),
          getParentWindow: () => parentWindow,
          executeRpc: async () => {
            executions += 1;
            assert.strictEqual(fs.statSync(destination).size, 0);
            fs.unlinkSync(destination);
            fs.writeFileSync(destination, "race-winner");
            return "secret-that-must-not-overwrite";
          },
        });
        const raced = await racedService.execute({
          chainTicker: "VRSC",
          method: "dumpprivkey",
          params: [],
        });
        assert.strictEqual(raced.code, "SAVE_FAILED");
        assert.strictEqual(fs.readFileSync(destination, "utf8"), "race-winner");
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps audited read-only requests prompt-free", async function () {
    let prompts = 0;
    let executedRequest;
    const service = createTerminalRpcApprovalService({
      dialog: approvedDialog({
        showMessageBox: async () => { prompts += 1; return { response: 1 }; },
      }),
      getParentWindow: () => null,
      executeRpc: async (request) => {
        executedRequest = request;
        return { blocks: 1 };
      },
    });

    const response = await service.execute({ chainTicker: "VRSC", method: "getinfo", params: [] });
    assert.strictEqual(prompts, 0);
    assert.strictEqual(Object.isFrozen(executedRequest), true);
    assert.deepStrictEqual(response, { status: "ok", result: { blocks: 1 } });
  });
});
