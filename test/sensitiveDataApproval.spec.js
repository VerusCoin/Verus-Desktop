"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  createSensitiveDataApprovalService: createRawSensitiveDataApprovalService,
  executeSensitiveReveal,
} = require("../routes/api/sensitiveDataApproval");
const {
  createNativeAuthorizationService,
} = require("../routes/api/native/nativeAuthorization");

const createSensitiveDataApprovalService = (dependencies) => {
  if (dependencies.nativeAuthorization != null) {
    return createRawSensitiveDataApprovalService(dependencies);
  }
  const nativeAuthorization = createNativeAuthorizationService({
    dialog: dependencies.dialog,
    getParentWindow: dependencies.getParentWindow,
    createOperationId: dependencies.createOperationId,
    now: dependencies.now,
    minPromptIntervalMs: dependencies.minPromptIntervalMs,
    maxPromptsPerWindow: dependencies.maxPromptsPerWindow,
    promptWindowMs: dependencies.promptWindowMs,
  });
  return createRawSensitiveDataApprovalService({
    ...dependencies,
    nativeAuthorization,
  });
};

const MAIN_HEADER = Object.freeze({
  builtin: true,
  app_id: "VERUS_DESKTOP_MAIN",
});

const usableWindow = (overrides = {}) => ({
  isDestroyed: () => false,
  isVisible: () => true,
  isFocused: () => true,
  webContents: { isDestroyed: () => false },
  ...overrides,
});

const privateKeyRequest = (overrides = {}) => ({
  kind: "private-key",
  source: "native",
  chainTicker: "VRSC",
  address: "RExampleAddress",
  callerBuiltin: true,
  callerAppId: "VERUS_DESKTOP_MAIN",
  ...overrides,
});

const invokeRoute = async (handler, body, apiHeader = MAIN_HEADER) => {
  let response;
  await handler(
    { body, api_header: apiHeader },
    { send(value) { response = JSON.parse(value); return this; } },
    () => {}
  );
  return response;
};

const capturePostRoute = (api, modulePath, wantedRoute) => {
  let registration;
  api.setPost = (route, handler, forceEncryption) => {
    if (route === wantedRoute) registration = { route, handler, forceEncryption };
  };
  api.setGet = () => {};
  require(modulePath)(api);
  assert.ok(registration, `${wantedRoute} was not registered`);
  return registration;
};

describe("native sensitive-data approval service", function () {
  it("uses the shared native coordinator without invoking its legacy prompt path", async function () {
    let fallbackPrompts = 0;
    let coordinatedPrompt;
    let revealCalls = 0;
    const parentWindow = usableWindow();
    const service = createSensitiveDataApprovalService({
      dialog: {
        showMessageBox: async () => {
          fallbackPrompts += 1;
          return { response: 0 };
        },
      },
      getParentWindow: () => parentWindow,
      nativeAuthorization: {
        async authorize(prompt) {
          coordinatedPrompt = prompt;
          return { status: "approved", operationId: "shared-sensitive-prompt" };
        },
      },
    });

    const outcome = await service.execute(privateKeyRequest(), async () => {
      revealCalls += 1;
      return "coordinated-private-key";
    });

    assert.deepStrictEqual(outcome, {
      status: "ok",
      result: "coordinated-private-key",
    });
    assert.strictEqual(fallbackPrompts, 0);
    assert.strictEqual(revealCalls, 1);
    assert.strictEqual(coordinatedPrompt.scope, "sensitive-data");
    assert.strictEqual(coordinatedPrompt.actionId, "sensitive-data:private-key:native");
  });

  it("uses a parent-bound, cancel-default dialog and executes one immutable request", async function () {
    const parentWindow = usableWindow();
    const auditEvents = [];
    const secret = "private-key-that-must-not-enter-dialogs-or-logs";
    const original = privateKeyRequest({
      title: secret,
      buttons: ["Always Allow"],
      approved: true,
    });
    let releaseDialog;
    let dialogOptions;
    let executedRequest;
    let executionCount = 0;

    const service = createSensitiveDataApprovalService({
      dialog: {
        showMessageBox: async (parent, options) => {
          assert.strictEqual(parent, parentWindow);
          dialogOptions = options;
          await new Promise((resolve) => { releaseDialog = resolve; });
          return { response: 1 };
        },
      },
      getParentWindow: () => parentWindow,
      createOperationId: () => "reveal-operation-1",
      audit: (event) => auditEvents.push(event),
    });

    const pending = service.execute(original, async (request) => {
      executionCount += 1;
      executedRequest = request;
      return secret;
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(service.isBusy(), true);
    assert.strictEqual(executionCount, 0);
    original.chainTicker = "ATTACKER";
    original.address = "RAttacker";
    releaseDialog();

    const response = await pending;
    assert.deepStrictEqual(response, { status: "ok", result: secret });
    assert.strictEqual(executionCount, 1);
    assert.strictEqual(service.isBusy(), false);
    assert.strictEqual(executedRequest.chainTicker, "VRSC");
    assert.strictEqual(executedRequest.address, "RExampleAddress");
    assert.strictEqual(Object.isFrozen(executedRequest), true);

    assert.strictEqual(dialogOptions.type, "warning");
    assert.strictEqual(dialogOptions.title, "Authorize Private-Key Reveal");
    assert.deepStrictEqual(dialogOptions.buttons, ["Cancel", "Reveal Once"]);
    assert.strictEqual(dialogOptions.defaultId, 0);
    assert.strictEqual(dialogOptions.cancelId, 0);
    assert.strictEqual(dialogOptions.noLink, true);
    assert.match(dialogOptions.detail, /Native wallet/);
    assert.match(dialogOptions.detail, /VRSC/);
    assert.match(dialogOptions.detail, /RExampleAddress/);
    assert.doesNotMatch(JSON.stringify(dialogOptions), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(auditEvents), new RegExp(secret));
  });

  it("does not run the reveal on cancellation, dialog failure, or an unavailable window", async function () {
    let executionCount = 0;
    const reveal = async () => {
      executionCount += 1;
      return "never-returned-secret";
    };

    const cancelled = createSensitiveDataApprovalService({
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      getParentWindow: () => usableWindow(),
    });
    assert.deepStrictEqual(await cancelled.execute(privateKeyRequest(), reveal), {
      status: "cancelled",
    });

    const failedDialog = createSensitiveDataApprovalService({
      dialog: { showMessageBox: async () => { throw new Error("secret dialog error"); } },
      getParentWindow: () => usableWindow(),
    });
    assert.deepStrictEqual(await failedDialog.execute(privateKeyRequest(), reveal), {
      status: "error",
      code: "DIALOG_FAILED",
      message: "Unable to obtain native authorization.",
    });

    const unfocused = createSensitiveDataApprovalService({
      dialog: { showMessageBox: async () => { throw new Error("must not open"); } },
      getParentWindow: () => usableWindow({ isFocused: () => false }),
    });
    assert.deepStrictEqual(await unfocused.execute(privateKeyRequest(), reveal), {
      status: "error",
      code: "WINDOW_UNAVAILABLE",
      message: "Focus the Verus Desktop window before revealing sensitive data.",
    });
    assert.strictEqual(executionCount, 0);
  });

  it("rejects non-main callers and overlapping or rate-limited prompts", async function () {
    const parentWindow = usableWindow();
    let releaseDialog;
    let now = 1000;
    let promptCount = 0;
    const service = createSensitiveDataApprovalService({
      dialog: {
        showMessageBox: async () => {
          promptCount += 1;
          if (promptCount === 1) {
            await new Promise((resolve) => { releaseDialog = resolve; });
          }
          return { response: 0 };
        },
      },
      getParentWindow: () => parentWindow,
      now: () => now,
      minPromptIntervalMs: 750,
    });

    const invalidCaller = await service.execute(
      privateKeyRequest({ callerAppId: "VERUS_LOGIN_CONSENT_UI" }),
      async () => "secret"
    );
    assert.strictEqual(invalidCaller.code, "INVALID_REQUEST");
    assert.strictEqual(promptCount, 0);

    const first = service.execute(privateKeyRequest(), async () => "secret");
    await new Promise((resolve) => setImmediate(resolve));
    const overlapping = await service.execute(privateKeyRequest(), async () => "secret");
    assert.strictEqual(overlapping.code, "BUSY");
    releaseDialog();
    assert.strictEqual((await first).status, "cancelled");

    now += 100;
    const limited = await service.execute(privateKeyRequest(), async () => "secret");
    assert.strictEqual(limited.code, "RATE_LIMITED");
    assert.strictEqual(promptCount, 1);
  });

  it("fails closed if the trusted window changes or secret retrieval fails", async function () {
    const firstWindow = usableWindow();
    const secondWindow = usableWindow();
    let currentWindow = firstWindow;
    let executionCount = 0;
    const changedWindow = createSensitiveDataApprovalService({
      dialog: {
        showMessageBox: async () => {
          currentWindow = secondWindow;
          return { response: 1 };
        },
      },
      getParentWindow: () => currentWindow,
    });
    const changedOutcome = await changedWindow.execute(privateKeyRequest(), async () => {
      executionCount += 1;
      return "secret";
    });
    assert.strictEqual(changedOutcome.code, "WINDOW_UNAVAILABLE");
    assert.strictEqual(executionCount, 0);

    let targetVersion = "target-1";
    const changedTarget = createSensitiveDataApprovalService({
      dialog: {
        showMessageBox: async () => {
          targetVersion = "target-2";
          return { response: 1 };
        },
      },
      getParentWindow: () => firstWindow,
      captureExecutionTarget: () => targetVersion,
      executionTargetMatches: (request, capturedTarget) => capturedTarget === targetVersion,
    });
    const targetOutcome = await changedTarget.execute(privateKeyRequest(), async () => {
      executionCount += 1;
      return "secret";
    });
    assert.strictEqual(targetOutcome.code, "TARGET_CHANGED");
    assert.strictEqual(executionCount, 0);

    const executorError = "daemon error containing private material";
    const failedReveal = createSensitiveDataApprovalService({
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      getParentWindow: () => firstWindow,
    });
    const failedOutcome = await failedReveal.execute(privateKeyRequest(), async () => {
      throw new Error(executorError);
    });
    assert.deepStrictEqual(failedOutcome, {
      status: "error",
      code: "REVEAL_FAILED",
      message: "The sensitive data could not be revealed.",
    });
    assert.doesNotMatch(JSON.stringify(failedOutcome), /daemon error|private material/);
  });

  it("uses seed-specific wording without accepting a renderer-supplied password or prompt", async function () {
    const parentWindow = usableWindow();
    const password = "correct horse battery staple";
    const seed = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
    let options;
    const service = createSensitiveDataApprovalService({
      dialog: {
        showMessageBox: async (parent, dialogOptions) => {
          options = dialogOptions;
          return { response: 1 };
        },
      },
      getParentWindow: () => parentWindow,
    });

    const outcome = await service.execute({
      kind: "seed",
      source: "pin",
      profile: "RProfileIdentifier",
      password,
      message: password,
      callerBuiltin: true,
      callerAppId: "VERUS_DESKTOP_MAIN",
    }, async () => seed);

    assert.deepStrictEqual(outcome, { status: "ok", result: seed });
    assert.strictEqual(options.title, "Authorize Seed Unlock");
    assert.deepStrictEqual(options.buttons, ["Cancel", "Unlock Once"]);
    assert.match(options.detail, /RProfileIdentifier/);
    assert.doesNotMatch(JSON.stringify(options), new RegExp(password));
    assert.doesNotMatch(JSON.stringify(options), new RegExp(seed));
  });
});

describe("sensitive-data reveal routes", function () {
  it("retrieves native private keys only inside an approved backend operation", async function () {
    const daemonCalls = [];
    let approvalRequest;
    let callsBeforeApproval;
    const api = {
      native: {
        callDaemon: async (...args) => {
          daemonCalls.push(args);
          return "native-private-key";
        },
      },
      sensitiveDataApproval: {
        execute: async (request, reveal) => {
          approvalRequest = request;
          callsBeforeApproval = daemonCalls.length;
          return {
            status: "ok",
            result: await reveal(request, {
              rpcTarget: { chain: "VRSC", port: 27486, user: "rpc-user", pass: "rpc-pass" },
            }),
          };
        },
      },
    };
    const registration = capturePostRoute(
      api,
      "../routes/api/native/addresses",
      "/native/get_privkey"
    );

    const response = await invokeRoute(registration.handler, {
      chainTicker: "VRSC",
      address: "RExampleAddress",
    });

    assert.strictEqual(registration.forceEncryption, true);
    assert.strictEqual(callsBeforeApproval, 0);
    assert.strictEqual(Object.isFrozen(approvalRequest), true);
    assert.deepStrictEqual(approvalRequest, {
      kind: "private-key",
      source: "native",
      chainTicker: "VRSC",
      address: "RExampleAddress",
      callerAppId: "VERUS_DESKTOP_MAIN",
      callerBuiltin: true,
    });
    assert.deepStrictEqual(daemonCalls, [[
      "VRSC",
      "dumpprivkey",
      ["RExampleAddress"],
      {
        redactLogs: true,
        rpcTarget: { chain: "VRSC", port: 27486, user: "rpc-user", pass: "rpc-pass" },
      },
    ]]);
    assert.deepStrictEqual(response, { msg: "success", result: "native-private-key" });

    daemonCalls.length = 0;
    await invokeRoute(registration.handler, {
      chainTicker: "VRSC",
      address: "zsExampleAddress",
    });
    assert.deepStrictEqual(daemonCalls, [[
      "VRSC",
      "z_exportkey",
      ["zsExampleAddress"],
      {
        redactLogs: true,
        rpcTarget: { chain: "VRSC", port: 27486, user: "rpc-user", pass: "rpc-pass" },
      },
    ]]);
  });

  it("keeps Electrum, ETH, and ERC-20 keys unread until approval and binds the wallet identity", async function () {
    const cases = [
      {
        modulePath: "../routes/api/electrum/addresses",
        route: "/electrum/get_privkey",
        body: { chainTicker: "VRSC", address: "RIgnoredByLegacyRoute" },
        expectedSource: "electrum",
        expectedAddress: "RElectrumAddress",
        makeApi(secretGetter) {
          return {
            electrum: {},
            electrumKeys: {
              vrsc: { pub: "RElectrumAddress", get priv() { return secretGetter(); } },
            },
          };
        },
      },
      {
        modulePath: "../routes/api/eth/addresses",
        route: "/eth/get_privkey",
        body: { chainTicker: "ETH", address: "0xIgnoredByLegacyRoute" },
        expectedSource: "eth",
        expectedAddress: "0xEthAddress",
        makeApi(secretGetter) {
          return {
            eth: {
              wallet: {
                address: "0xEthAddress",
                signer: { signingKey: { get privateKey() { return secretGetter(); } } },
              },
            },
          };
        },
      },
      {
        modulePath: "../routes/api/erc20/addresses",
        route: "/erc20/get_privkey",
        body: { chainTicker: "DAI", address: "0xIgnoredByLegacyRoute" },
        expectedSource: "erc20",
        expectedAddress: "0xErc20Address",
        makeApi(secretGetter) {
          return {
            erc20: {
              wallet: {
                address: "0xErc20Address",
                signer: { signingKey: { get privateKey() { return secretGetter(); } } },
              },
            },
          };
        },
      },
    ];

    for (const testCase of cases) {
      let secretReads = 0;
      const secret = `${testCase.expectedSource}-private-key`;
      const api = testCase.makeApi(() => {
        secretReads += 1;
        return secret;
      });
      let approvedRequest;
      api.sensitiveDataApproval = {
        execute: async (request, reveal) => {
          approvedRequest = request;
          assert.strictEqual(secretReads, 0);
          return { status: "ok", result: await reveal(request) };
        },
      };
      const registration = capturePostRoute(api, testCase.modulePath, testCase.route);
      const response = await invokeRoute(registration.handler, testCase.body);

      assert.strictEqual(registration.forceEncryption, true);
      assert.strictEqual(approvedRequest.source, testCase.expectedSource);
      assert.strictEqual(approvedRequest.address, testCase.expectedAddress);
      assert.strictEqual(approvedRequest.callerAppId, "VERUS_DESKTOP_MAIN");
      assert.strictEqual(secretReads, 1);
      assert.deepStrictEqual(response, { msg: "success", result: secret });
    }
  });

  it("fails closed without the service, on cancellation, and if an approved wallet changes", async function () {
    let executorCalls = 0;
    const unavailable = await executeSensitiveReveal(
      {},
      { api_header: MAIN_HEADER },
      privateKeyRequest(),
      async () => { executorCalls += 1; return "secret"; }
    );
    assert.match(unavailable.result, /unavailable.*nothing was revealed/i);

    const cancelled = await executeSensitiveReveal(
      { sensitiveDataApproval: { execute: async () => ({ status: "cancelled" }) } },
      { api_header: MAIN_HEADER },
      privateKeyRequest(),
      async () => { executorCalls += 1; return "secret"; }
    );
    assert.deepStrictEqual(cancelled, { msg: "error", result: "Sensitive-data reveal cancelled." });
    assert.strictEqual(executorCalls, 0);

    const oldSecret = "old-wallet-private-key";
    const newSecret = "new-wallet-private-key";
    const oldWallet = {
      address: "0xOldAddress",
      signer: { signingKey: { privateKey: oldSecret } },
    };
    const api = { eth: { wallet: oldWallet } };
    api.sensitiveDataApproval = {
      execute: async (request, reveal) => {
        api.eth.wallet = {
          address: "0xNewAddress",
          signer: { signingKey: { privateKey: newSecret } },
        };
        try {
          return { status: "ok", result: await reveal(request) };
        } catch (error) {
          return { status: "error", message: "The sensitive data could not be revealed." };
        }
      },
    };
    const registration = capturePostRoute(api, "../routes/api/eth/addresses", "/eth/get_privkey");
    const response = await invokeRoute(registration.handler, { chainTicker: "ETH" });
    assert.deepStrictEqual(response, {
      msg: "error",
      result: "The sensitive data could not be revealed.",
    });
    assert.doesNotMatch(JSON.stringify(response), /old-wallet|new-wallet/);
  });

  it("routes a successfully decrypted profile seed through native authorization before responding", async function () {
    const fs = require("fs-extra");
    const os = require("os");
    const path = require("path");
    const iocane = require("iocane");
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-seed-approval-"));
    const pinDirectory = path.join(temporaryRoot, "shepherd", "pin");
    const profile = "current_profile";
    const password = "correct horse battery staple 123!";
    const seed = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
    let registration;
    let authorizationRequest;
    let authorizationCalls = 0;

    try {
      await fs.ensureDir(pinDirectory);
      const session = iocane.createSession().use("cbc").setDerivationRounds(300000);
      await fs.writeFile(
        path.join(pinDirectory, `${profile}.pin`),
        await session.encrypt(seed, password)
      );

      const api = {
        paths: { agamaDir: temporaryRoot },
        getNetworkData() {
          return require("../routes/electrumjs/electrumjs.networks").btc;
        },
        log() {},
        sensitiveDataApproval: {
          execute: async (request) => {
            authorizationCalls += 1;
            authorizationRequest = request;
            return { status: "cancelled" };
          },
        },
        setPost(route, handler, forceEncryption) {
          if (route === "/decryptkey") registration = { handler, forceEncryption };
        },
      };
      require("../routes/api/pin")(api);

      const response = await invokeRoute(registration.handler, { pubkey: profile, key: password });
      assert.strictEqual(registration.forceEncryption, true);
      assert.strictEqual(authorizationCalls, 1);
      assert.deepStrictEqual(authorizationRequest, {
        kind: "seed",
        source: "pin",
        profile,
        callerAppId: "VERUS_DESKTOP_MAIN",
        callerBuiltin: true,
      });
      assert.deepStrictEqual(response, {
        msg: "error",
        result: "Sensitive-data reveal cancelled.",
      });
      assert.doesNotMatch(JSON.stringify(response), new RegExp(seed));
      assert.doesNotMatch(JSON.stringify(authorizationRequest), new RegExp(password));
      assert.doesNotMatch(JSON.stringify(authorizationRequest), new RegExp(seed));
    } finally {
      await fs.remove(temporaryRoot);
    }
  });
});
