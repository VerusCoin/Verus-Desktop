"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { EventEmitter } = require("node:events");
const express = require("express");

const createApi = () => {
  const routes = new Map();
  const api = {
    appConfig: {
      general: {
        main: {
          livelog: false,
          requireNativeAuthForIrreversibleActions: true,
        },
      },
    },
    BuiltinSecret: "test-secret",
    confFileIndex: { VRSC: "/wallet/VRSC.conf" },
    rpcConf: {
      VRSC: { port: 27486, user: "approved-user", pass: "approved-pass" },
    },
    native: {},
    get() {},
    post(route, handler) { routes.set(route, handler); },
    rpcCalls: { GET: {}, POST: {} },
    isIrreversibleAuthorizationEnabled: () => true,
    log() {},
    writeLog() {},
    nativeAuthorization: {
      authorize: async () => ({ status: "approved", operationId: "approved-operation" }),
    },
  };
  require("../routes/api/auth")(api);
  api.checkToken = () => true;

  const invoke = async (route, payload, options = {}) => {
    let responseValue;
    const response = Object.assign(new EventEmitter(), {
      headersSent: false,
      type() {},
      status() { return this; },
      send(value) {
        this.headersSent = true;
        responseValue = JSON.parse(value);
        return this;
      },
    });
    if (typeof options.onResponse === "function") options.onResponse(response);
    await routes.get(route)(
      {
        body: {
          app_id: "VERUS_DESKTOP_MAIN",
          builtin: true,
          encrypted: false,
          payload,
          time: Date.now(),
          validity_key: "unused",
        },
      },
      response,
      () => {}
    );
    return responseValue == null ? null : JSON.parse(responseValue.payload);
  };

  return { api, invoke };
};

describe("protected action execution binding", function () {
  it("initializes against the callable Express Router used by the application", function () {
    const api = express.Router();
    api.rpcCalls = { GET: {}, POST: {} };

    assert.strictEqual(require("../routes/api/auth")(api), api);
    assert.strictEqual(typeof api.protectedActionExecution.reserveProtected, "function");
  });

  it("keeps the lease through callback-style completion and blocks target mutation", async function () {
    const { api, invoke } = createApi();
    let releaseHandler;
    let handlerStarted;
    const started = new Promise((resolve) => { handlerStarted = resolve; });
    let mutationExecutions = 0;

    api.setPost("/native/sendtx", (req, res) => {
      handlerStarted();
      new Promise((resolve) => { releaseHandler = resolve; }).then(() => {
        res.send(JSON.stringify({ msg: "success", result: "sent" }));
      });
      // Deliberately do not return the promise: this mirrors legacy routes.
    });
    api.setPost("/eth/logout", (req, res) => {
      mutationExecutions += 1;
      res.send(JSON.stringify({ msg: "success" }));
    });

    const protectedCall = invoke("/native/sendtx", {
      chainTicker: "VRSC",
      amount: 1,
    });
    await started;

    const mutation = await invoke("/eth/logout", {});
    assert.strictEqual(mutation.msg, "error");
    assert.match(mutation.result, /protected wallet action is active/i);
    assert.strictEqual(mutationExecutions, 0);

    releaseHandler();
    assert.deepStrictEqual(await protectedCall, { msg: "success", result: "sent" });
    assert.deepStrictEqual(await invoke("/eth/logout", {}), { msg: "success" });
    assert.strictEqual(mutationExecutions, 1);
  });

  it("rejects approval if the selected target changes while the native dialog is open", async function () {
    const { api, invoke } = createApi();
    let resolveAuthorization;
    api.nativeAuthorization.authorize = () => new Promise((resolve) => {
      resolveAuthorization = resolve;
    });
    let executions = 0;
    api.setPost("/native/sendtx", (req, res) => {
      executions += 1;
      res.send(JSON.stringify({ msg: "success" }));
    });

    const pending = invoke("/native/sendtx", { chainTicker: "VRSC", amount: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    api.rpcConf.VRSC = { port: 27487, user: "other-user", pass: "other-pass" };
    resolveAuthorization({ status: "approved", operationId: "stale-operation" });

    const outcome = await pending;
    assert.strictEqual(outcome.msg, "error");
    assert.match(outcome.result, /target changed/i);
    assert.strictEqual(executions, 0);
  });

  it("pins native RPC execution to the approved target for the full async handler lifetime", async function () {
    const { api, invoke } = createApi();
    let continueHandler;
    let handlerStarted;
    const started = new Promise((resolve) => { handlerStarted = resolve; });
    let sentOptions;

    api.sendToCli = async (payload, options) => {
      sentOptions = options;
      return {
        body: JSON.stringify({ result: "txid", error: null }),
        confirmedDaemonResponse: true,
      };
    };
    require("../routes/api/native/callDaemon")(api);
    api.setPost("/native/sendtx", (req, res) => {
      handlerStarted();
      new Promise((resolve) => { continueHandler = resolve; })
        .then(() => api.native.callDaemon("VRSC", "sendcurrency", []))
        .then((result) => res.send(JSON.stringify({ msg: "success", result })));
    });

    const pending = invoke("/native/sendtx", { chainTicker: "VRSC", amount: 1 });
    await started;
    api.rpcConf.VRSC = { port: 9999, user: "attacker", pass: "attacker" };
    continueHandler();

    assert.deepStrictEqual(await pending, { msg: "success", result: "txid" });
    assert.deepStrictEqual(sentOptions.rpcTarget, {
      chain: "VRSC",
      port: 27486,
      user: "approved-user",
      pass: "approved-pass",
    });
  });

  it("revokes a timed-out callback context before releasing the global lease", async function () {
    const { api, invoke } = createApi();
    api.protectedActionResponseTimeoutMs = 20;
    let cliExecutions = 0;
    api.sendToCli = async () => {
      cliExecutions += 1;
      return {
        body: JSON.stringify({ result: "unexpected", error: null }),
        confirmedDaemonResponse: true,
      };
    };
    require("../routes/api/native/callDaemon")(api);

    let resolveLateOutcome;
    const lateOutcome = new Promise((resolve) => { resolveLateOutcome = resolve; });
    api.setPost("/native/sendtx", () => {
      setTimeout(() => {
        api.native.callDaemon("VRSC", "sendcurrency", [])
          .then(
            () => resolveLateOutcome("executed"),
            (error) => resolveLateOutcome(error.message)
          );
      }, 50);
    });
    api.setPost("/eth/logout", (req, res) => {
      res.send(JSON.stringify({ msg: "success" }));
    });

    const timedOut = await invoke("/native/sendtx", {
      chainTicker: "VRSC",
      amount: 1,
    });
    assert.strictEqual(timedOut.msg, "error");
    assert.match(timedOut.result, /authorization was revoked/i);
    assert.deepStrictEqual(await invoke("/eth/logout", {}), { msg: "success" });
    assert.match(await lateOutcome, /request ended before execution completed/i);
    assert.strictEqual(cliExecutions, 0);
  });

  it("revokes a disconnected request before allowing target mutation", async function () {
    const { api, invoke } = createApi();
    let response;
    let handlerStarted;
    const started = new Promise((resolve) => { handlerStarted = resolve; });
    let releaseLateHandler;
    let lateOutcome;
    const lateHandler = new Promise((resolve) => { releaseLateHandler = resolve; });

    api.sendToCli = async () => {
      throw new Error("revoked execution reached the daemon");
    };
    require("../routes/api/native/callDaemon")(api);
    api.setPost("/native/sendtx", () => {
      handlerStarted();
      lateHandler
        .then(() => api.native.callDaemon("VRSC", "sendcurrency", []))
        .then(
          () => { lateOutcome = "executed"; },
          (error) => { lateOutcome = error.message; }
        );
    });
    api.setPost("/eth/logout", (req, res) => {
      res.send(JSON.stringify({ msg: "success" }));
    });

    const disconnected = invoke(
      "/native/sendtx",
      { chainTicker: "VRSC", amount: 1 },
      { onResponse(value) { response = value; } }
    );
    await started;
    response.destroyed = true;
    response.emit("close");
    assert.strictEqual(await disconnected, null);
    assert.deepStrictEqual(await invoke("/eth/logout", {}), { msg: "success" });

    releaseLateHandler();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(lateOutcome, /request ended before execution completed/i);
  });

  it("exposes a transport-neutral guard for late protected broadcasts", async function () {
    const { api, invoke } = createApi();
    api.protectedActionResponseTimeoutMs = 20;
    api.eth = {
      wallet: { address: "0xapproved" },
      interface: {
        network: { id: 1 },
        InfuraProvider: {},
        DefaultProvider: {},
      },
    };
    let broadcastExecutions = 0;
    let resolveLateOutcome;
    const lateOutcome = new Promise((resolve) => { resolveLateOutcome = resolve; });

    api.setPost("/eth/sendtx", () => {
      setTimeout(() => {
        try {
          api.assertProtectedActionExecutionActive();
          broadcastExecutions += 1;
          resolveLateOutcome("executed");
        } catch (error) {
          resolveLateOutcome(error.message);
        }
      }, 50);
    });

    const timedOut = await invoke("/eth/sendtx", { toAddress: "0x1234", amount: 1 });
    assert.match(timedOut.result, /authorization was revoked/i);
    assert.match(await lateOutcome, /request ended before execution completed/i);
    assert.strictEqual(broadcastExecutions, 0);
  });
});
