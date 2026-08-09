"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const util = require("node:util");
const axios = require("axios");
const blake2b = require("blake2b");
const CryptoJS = require("crypto-js");

const createApi = ({ livelog = false, sendToCli } = {}) => {
  let registration;
  const logs = [];
  const writeLogs = [];
  const api = {
    appConfig: { general: { main: { livelog } } },
    native: {},
    setPost(route, handler, forceEncryption) {
      registration = { route, handler, forceEncryption };
    },
    sendToCli: sendToCli || (async () => JSON.stringify({ result: null, error: null })),
    log(value, type) { logs.push({ value, type }); },
    writeLog(value, type) { writeLogs.push({ value, type }); },
  };
  require("../routes/api/native/callDaemon")(api);
  return { api, getRegistration: () => registration, logs, writeLogs };
};

const invokeRoute = async (handler, body, apiHeader = {
  builtin: true,
  app_id: "VERUS_DESKTOP_MAIN",
}) => {
  let response;
  await handler(
    { body, api_header: apiHeader },
    { send(value) { response = JSON.parse(value); return this; } },
    () => {}
  );
  return response;
};

const inspectCapturedLogs = (entries) => entries.map(({ value, type }) => [
  type,
  String(value),
  value && value.message,
  value && value.stack,
  util.inspect(value, { depth: 8 }),
].filter(Boolean).join("\n")).join("\n");

describe("GUI daemon terminal route", function () {
  it("enforces builtin authentication, encrypted framing, caller identity, and replay protection", async function () {
    let wrappedHandler;
    let executionCount = 0;
    const builtinSecret = "terminal-auth-test-secret";
    const api = {
      appConfig: { general: { main: { livelog: false } } },
      BuiltinSecret: builtinSecret,
      native: {},
      rpcCalls: { GET: {}, POST: {} },
      get() {},
      post(route, handler) { wrappedHandler = handler; },
      log() {},
      writeLog() {},
      sendToCli: async () => JSON.stringify({ result: null, error: null }),
    };
    require("../routes/api/auth")(api);
    require("../routes/api/native/callDaemon")(api);
    api.native.callDaemon = async () => {
      executionCount += 1;
      return { value: "read-result-plaintext" };
    };

    const tokenFor = (time, appId) => {
      const hash = blake2b(64);
      for (const value of [String(time), builtinSecret, "native/call_daemon", appId]) {
        hash.update(Buffer.from(value));
      }
      return hash.digest("hex");
    };
    const makeEnvelope = ({
      time,
      appId = "VERUS_DESKTOP_MAIN",
      encrypted = true,
      payload = { chainTicker: "VRSC", cmd: "getinfo", params: [] },
      token = tokenFor(time, appId),
    }) => ({
      validity_key: token,
      app_id: appId,
      builtin: true,
      encrypted,
      time,
      payload: encrypted
        ? CryptoJS.AES.encrypt(JSON.stringify(payload), builtinSecret).toString()
        : payload,
    });
    const invokeWrapped = async (body) => {
      let status = 200;
      let wire;
      const response = {
        headersSent: false,
        type() {},
        status(value) { status = value; return this; },
        send(value) { this.headersSent = true; wire = String(value); return this; },
      };
      await wrappedHandler({ body }, response, () => {});
      return { status, wire, envelope: JSON.parse(wire) };
    };

    const firstTime = Date.now();
    const validEnvelope = makeEnvelope({
      time: firstTime,
      payload: {
        chainTicker: "VRSC",
        cmd: "getinfo",
        params: [],
        api_header: { builtin: false, app_id: "ATTACKER" },
      },
    });
    const valid = await invokeWrapped(validEnvelope);
    assert.strictEqual(valid.status, 200);
    assert.doesNotMatch(valid.wire, /read-result-plaintext/);
    const validPlaintext = CryptoJS.AES.decrypt(
      valid.envelope.payload,
      builtinSecret
    ).toString(CryptoJS.enc.Utf8);
    assert.deepStrictEqual(JSON.parse(validPlaintext), {
      msg: "success",
      result: { value: "read-result-plaintext" },
    });
    assert.strictEqual(executionCount, 1);

    const replay = await invokeWrapped(validEnvelope);
    assert.strictEqual(replay.status, 401);
    assert.strictEqual(executionCount, 1);

    const unencrypted = await invokeWrapped(makeEnvelope({
      time: firstTime + 1,
      encrypted: false,
    }));
    assert.strictEqual(unencrypted.status, 400);
    assert.strictEqual(executionCount, 1);

    const otherId = "SOME_OTHER_RENDERER";
    const wrongCaller = await invokeWrapped(makeEnvelope({
      time: firstTime + 2,
      appId: otherId,
    }));
    assert.strictEqual(wrongCaller.status, 200);
    const wrongCallerPlaintext = CryptoJS.AES.decrypt(
      wrongCaller.envelope.payload,
      builtinSecret
    ).toString(CryptoJS.enc.Utf8);
    assert.match(JSON.parse(wrongCallerPlaintext).result, /built-in application/i);
    assert.strictEqual(executionCount, 1);

    const invalidToken = await invokeWrapped(makeEnvelope({
      time: firstTime + 3,
      token: "0".repeat(128),
    }));
    assert.strictEqual(invalidToken.status, 401);
    assert.strictEqual(executionCount, 1);
  });

  it("remains encrypted and executes audited read-only calls without approval", async function () {
    const { api, getRegistration } = createApi();
    const registration = getRegistration();
    const calls = [];
    api.native.callDaemon = async (...args) => {
      calls.push(args);
      return { blocks: 123 };
    };

    const response = await invokeRoute(registration.handler, {
      chainTicker: "VRSC",
      cmd: "getinfo",
      params: [],
    });

    assert.strictEqual(registration.route, "/native/call_daemon");
    assert.strictEqual(registration.forceEncryption, true);
    assert.deepStrictEqual(calls, [["VRSC", "getinfo", [], { redactLogs: true }]]);
    assert.deepStrictEqual(response, { msg: "success", result: { blocks: 123 } });
  });

  it("passes privileged calls only to the backend approval transaction and ignores forged control fields", async function () {
    const { api, getRegistration } = createApi();
    let directCalls = 0;
    let approvedRequest;
    let finishApproval;
    api.native.callDaemon = async () => { directCalls += 1; };
    api.terminalRpcApproval = {
      execute: async (request) => {
        approvedRequest = request;
        await new Promise((resolve) => { finishApproval = resolve; });
        return { status: "ok", result: { opid: "real" } };
      },
    };
    const body = {
      chainTicker: "VRSC",
      cmd: "z_sendmany",
      params: ["from", [{ address: "to", amount: 1 }]],
      approved: true,
      classification: "read-only",
      savePath: "/tmp/renderer-chosen.txt",
      operationId: "reusable-approval",
    };

    const pendingResponse = invokeRoute(getRegistration().handler, body);
    await new Promise((resolve) => setImmediate(resolve));
    body.chainTicker = "ATTACKER";
    body.params[1][0].amount = 999;

    assert.deepStrictEqual(Object.keys(approvedRequest).sort(), ["chainTicker", "method", "params"]);
    assert.strictEqual(approvedRequest.chainTicker, "VRSC");
    assert.strictEqual(approvedRequest.method, "z_sendmany");
    assert.strictEqual(approvedRequest.params[1][0].amount, 1);
    assert.strictEqual(Object.isFrozen(approvedRequest.params[1][0]), true);
    finishApproval();

    assert.deepStrictEqual(await pendingResponse, {
      msg: "success",
      result: { opid: "real" },
    });
    assert.strictEqual(directCalls, 0);
  });

  it("fails closed when native approval is unavailable or cancelled", async function () {
    const { api, getRegistration } = createApi();
    let directCalls = 0;
    api.native.callDaemon = async () => { directCalls += 1; };
    const request = { chainTicker: "VRSC", cmd: "stop", params: [] };

    const unavailable = await invokeRoute(getRegistration().handler, request);
    assert.match(unavailable.result, /approval is unavailable/i);

    api.terminalRpcApproval = {
      execute: async () => ({ status: "cancelled", stage: "approval" }),
    };
    const cancelled = await invokeRoute(getRegistration().handler, request);
    assert.match(cancelled.result, /cancelled; nothing was executed/i);
    assert.strictEqual(directCalls, 0);

    api.terminalRpcApproval.execute = async () => ({ status: "saved" });
    const mismatchedSaved = await invokeRoute(getRegistration().handler, {
      chainTicker: "VRSC",
      cmd: "stop",
      params: [],
    });
    assert.deepStrictEqual(mismatchedSaved, {
      msg: "error",
      result: "Daemon command was not executed.",
    });
  });

  it("never returns sensitive output, a destination path, or a raw sensitive error", async function () {
    const { api, getRegistration } = createApi();
    const secret = "L1-private-key-material";
    const destination = "/Users/example/private-key.txt";
    api.terminalRpcApproval = {
      execute: async () => ({ status: "saved", result: secret, path: destination }),
    };

    const saved = await invokeRoute(getRegistration().handler, {
      chainTicker: "VRSC",
      cmd: "dumpprivkey",
      params: ["RAddress"],
    });
    assert.deepStrictEqual(saved, {
      msg: "success",
      result: "Sensitive command output was saved to the selected file.",
    });
    assert.doesNotMatch(JSON.stringify(saved), /L1-private|private-key\.txt|Users/);

    const savedShieldedMemo = await invokeRoute(getRegistration().handler, {
      chainTicker: "VRSC",
      cmd: "z_viewtransaction",
      params: ["transaction-id"],
    });
    assert.deepStrictEqual(savedShieldedMemo, {
      msg: "success",
      result: "Sensitive command output was saved to the selected file.",
    });

    api.terminalRpcApproval.execute = async () => ({ status: "ok", result: secret });
    const mismatchedPolicy = await invokeRoute(getRegistration().handler, {
      chainTicker: "VRSC",
      cmd: "dumpprivkey",
      params: ["RAddress"],
    });
    assert.strictEqual(mismatchedPolicy.msg, "error");
    assert.doesNotMatch(JSON.stringify(mismatchedPolicy), /L1-private/);

    api.terminalRpcApproval.execute = async () => ({
      status: "error",
      code: "RPC_OUTCOME_UNKNOWN",
      message: `daemon echoed ${secret}`,
      rawError: `daemon echoed ${secret}`,
      path: destination,
    });
    const failed = await invokeRoute(getRegistration().handler, {
      chainTicker: "VRSC",
      cmd: "dumpprivkey",
      params: ["RAddress"],
    });
    assert.deepStrictEqual(failed, {
      msg: "error",
      result:
        "The daemon did not return a confirmed result. The command may have executed; verify wallet and node state before retrying.",
    });
    assert.doesNotMatch(JSON.stringify(failed), /L1-private|private-key\.txt|Users/);

    api.terminalRpcApproval.execute = async () => ({
      status: "error",
      code: "RPC_FAILED",
      message: `daemon echoed ${secret}`,
      rawError: `daemon echoed ${secret}`,
      path: destination,
    });
    const confirmedFailure = await invokeRoute(getRegistration().handler, {
      chainTicker: "VRSC",
      cmd: "dumpprivkey",
      params: ["RAddress"],
    });
    assert.deepStrictEqual(confirmedFailure, {
      msg: "error",
      result: "Daemon command failed. No sensitive output was returned.",
    });
    assert.doesNotMatch(JSON.stringify(confirmedFailure), /L1-private|private-key\.txt|Users/);

    api.terminalRpcApproval.execute = async () => ({ status: "error", code: "toString" });
    const inheritedCode = await invokeRoute(getRegistration().handler, {
      chainTicker: "VRSC",
      cmd: "dumpprivkey",
      params: ["RAddress"],
    });
    assert.deepStrictEqual(inheritedCode, {
      msg: "error",
      result: "Daemon command was not executed.",
    });
  });

  it("rejects non-main callers and malformed commands before approval", async function () {
    const { api, getRegistration } = createApi();
    let approvals = 0;
    api.terminalRpcApproval = { execute: async () => { approvals += 1; } };

    const wrongCaller = await invokeRoute(
      getRegistration().handler,
      { chainTicker: "VRSC", cmd: "stop", params: [] },
      { builtin: true, app_id: "SOME_OTHER_RENDERER" }
    );
    assert.match(wrongCaller.result, /built-in application/i);

    for (const body of [
      { chainTicker: "VRSC;touch", cmd: "stop", params: [] },
      { chainTicker: "VRSC", cmd: "Stop", params: [] },
      { chainTicker: "VRSC", cmd: "stop;touch", params: [] },
      { chainTicker: "VRSC", cmd: "stop", params: "[]" },
    ]) {
      const response = await invokeRoute(getRegistration().handler, body);
      assert.match(response.result, /Invalid chain or daemon RPC request/);
    }
    assert.strictEqual(approvals, 0);
  });

  it("withholds terminal parameters, results, daemon messages, and exception objects from logs", async function () {
    const secretParam = "wallet-passphrase-secret";
    const secretResult = "private-key-secret";
    const successHarness = createApi({
      livelog: true,
      sendToCli: async () => JSON.stringify({ result: secretResult, error: null }),
    });
    assert.strictEqual(
      await successHarness.api.native.callDaemon(
        "VRSC",
        "dumpprivkey",
        [secretParam],
        { redactLogs: true }
      ),
      secretResult
    );
    assert.doesNotMatch(inspectCapturedLogs(successHarness.writeLogs), new RegExp(`${secretParam}|${secretResult}`));
    assert.match(inspectCapturedLogs(successHarness.writeLogs), /terminal parameters withheld/);
    assert.match(inspectCapturedLogs(successHarness.writeLogs), /terminal result withheld/);

    const daemonErrorSecret = "daemon-echoed-secret";
    const errorHarness = createApi({
      livelog: true,
      sendToCli: async () => ({
        body: JSON.stringify({
          result: null,
          error: { code: -4, message: daemonErrorSecret },
        }),
        confirmedDaemonResponse: true,
      }),
    });
    await assert.rejects(
      errorHarness.api.native.callDaemon("VRSC", "walletpassphrase", [secretParam], { redactLogs: true }),
      (error) => {
        assert.strictEqual(error.code, -4);
        assert.strictEqual(error.message, daemonErrorSecret);
        assert.strictEqual(error.confirmedDaemonResponse, true);
        return true;
      }
    );
    assert.doesNotMatch(
      inspectCapturedLogs([...errorHarness.logs, ...errorHarness.writeLogs]),
      new RegExp(`${secretParam}|${daemonErrorSecret}`)
    );

    const transportErrorSecret = "transport-error-not-for-native-alert";
    const transportHarness = createApi({
      livelog: true,
      sendToCli: async () => ({
        body: JSON.stringify({
          result: null,
          error: { code: 501, message: transportErrorSecret },
        }),
        confirmedDaemonResponse: false,
      }),
    });
    await assert.rejects(
      transportHarness.api.native.callDaemon("VRSC", "dumpprivkey", [secretParam], { redactLogs: true }),
      (error) => {
        assert.strictEqual(error.message, transportErrorSecret);
        assert.strictEqual(
          Object.prototype.hasOwnProperty.call(error, "confirmedDaemonResponse"),
          false
        );
        return true;
      }
    );
    assert.doesNotMatch(
      inspectCapturedLogs([...transportHarness.logs, ...transportHarness.writeLogs]),
      new RegExp(`${secretParam}|${transportErrorSecret}`)
    );

    const thrownSecret = "axios-config-contained-secret";
    const thrownHarness = createApi({
      livelog: true,
      sendToCli: async () => { throw new Error(thrownSecret); },
    });
    await assert.rejects(
      thrownHarness.api.native.callDaemon("VRSC", "dumpprivkey", [secretParam], { redactLogs: true })
    );
    assert.doesNotMatch(
      inspectCapturedLogs([...thrownHarness.logs, ...thrownHarness.writeLogs]),
      new RegExp(`${secretParam}|${thrownSecret}`)
    );

    const runtimeLogHarness = createApi({
      livelog: false,
      sendToCli: async () => { throw new Error(thrownSecret); },
    });
    await assert.rejects(
      runtimeLogHarness.api.native.callDaemon(
        "VRSC",
        "dumpprivkey",
        [secretParam],
        { redactLogs: true }
      )
    );
    assert.doesNotMatch(
      inspectCapturedLogs(runtimeLogHarness.logs),
      new RegExp(`${secretParam}|${thrownSecret}`)
    );
  });

  it("sends daemon RPC only to loopback with proxying disabled and a bounded timeout", async function () {
    const originalPost = axios.post;
    let captured;
    axios.post = async (...args) => {
      captured = args;
      return { data: { result: "ok", error: null } };
    };

    try {
      const api = {
        rpcConf: {
          VRSC: {
            port: 27486,
            user: "rpc-user",
            pass: "rpc-password",
            pendingUpdate: true,
          },
        },
        nativeCoindList: {},
        coinsInitializing: {},
        getConf() { throw new Error("configured target should not reload"); },
        log() {},
      };
      require("../routes/api/rpc")(api);
      const response = await api.sendToCli({
        chain: "VRSC",
        cmd: "walletpassphrase",
        params: ["secret-passphrase", 30],
      });

      assert.deepStrictEqual(JSON.parse(response), { result: "ok", error: null });
      assert.strictEqual(captured[0], "http://127.0.0.1:27486");
      assert.deepStrictEqual(captured[1], {
        agent: "bitcoinrpc",
        method: "walletpassphrase",
        params: ["secret-passphrase", 30],
      });
      assert.deepStrictEqual(captured[2], {
        proxy: false,
        timeout: 600000,
        auth: { username: "rpc-user", password: "rpc-password" },
      });

      api.rpcConf.VRSC.port = 19999;
      api.rpcConf.VRSC.user = "changed-user";
      api.rpcConf.VRSC.pass = "changed-password";
      const pinnedResponse = await api.sendToCli(
        { chain: "VRSC", cmd: "stop", params: [] },
        {
          includeResponseMetadata: true,
          rpcTarget: Object.freeze({
            chain: "VRSC",
            port: 27486,
            user: "approved-user",
            pass: "approved-password",
          }),
        }
      );
      assert.deepStrictEqual(pinnedResponse, {
        body: JSON.stringify({ result: "ok", error: null }),
        confirmedDaemonResponse: true,
      });
      assert.strictEqual(captured[0], "http://127.0.0.1:27486");
      assert.deepStrictEqual(captured[2].auth, {
        username: "approved-user",
        password: "approved-password",
      });

      axios.post = async () => {
        const error = new Error("connection refused");
        error.code = "ECONNREFUSED";
        throw error;
      };
      const unavailableResponse = await api.sendToCli(
        { chain: "VRSC", cmd: "dumpprivkey", params: ["RAddress"] },
        {
          includeResponseMetadata: true,
          rpcTarget: Object.freeze({
            chain: "VRSC",
            port: 27486,
            user: "approved-user",
            pass: "approved-password",
          }),
        }
      );
      assert.strictEqual(unavailableResponse.confirmedDaemonResponse, false);
      assert.match(JSON.parse(unavailableResponse.body).error.message, /No running VRSC daemon/i);

      axios.post = async () => {
        const error = new Error("daemon HTTP error");
        error.response = {
          data: { result: null, error: { code: -5, message: "Invalid address" } },
        };
        throw error;
      };
      const daemonFailureResponse = await api.sendToCli(
        { chain: "VRSC", cmd: "dumpprivkey", params: ["RAddress"] },
        {
          includeResponseMetadata: true,
          rpcTarget: Object.freeze({
            chain: "VRSC",
            port: 27486,
            user: "approved-user",
            pass: "approved-password",
          }),
        }
      );
      assert.strictEqual(daemonFailureResponse.confirmedDaemonResponse, true);
      assert.deepStrictEqual(JSON.parse(daemonFailureResponse.body), {
        result: null,
        error: { code: -5, message: "Invalid address" },
      });
    } finally {
      axios.post = originalPost;
    }
  });
});
