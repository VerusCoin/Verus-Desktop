"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  REDACTED_VALUE,
  classifyTerminalRpcMethod,
  createTerminalRpcRequest,
  formatTerminalRpcRequest,
  isValidRpcMethod,
  redactTerminalRpcParams,
} = require("../routes/api/native/terminalRpcSecurity");

describe("terminal RPC policy", function () {
  it("keeps read-only calls prompt-free and classifies spend/sign calls for the strongest warning", function () {
    assert.deepStrictEqual(classifyTerminalRpcMethod("getinfo"), {
      kind: "read-only",
      highRisk: false,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("sendcurrency"), {
      kind: "privileged",
      highRisk: true,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("z_sendmany"), {
      kind: "privileged",
      highRisk: true,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("signrawtransaction"), {
      kind: "privileged",
      highRisk: true,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("encryptdata"), {
      kind: "sensitive-output",
      highRisk: true,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("stop"), {
      kind: "privileged",
      highRisk: false,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("getchaintips"), {
      kind: "read-only",
      highRisk: false,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("z_viewtransaction"), {
      kind: "sensitive-output",
      highRisk: false,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("getaccountaddress"), {
      kind: "privileged",
      highRisk: false,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("generateadjustmentreport"), {
      kind: "privileged",
      highRisk: true,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("dumpwallet"), {
      kind: "privileged",
      highRisk: true,
      sensitiveFileSideEffect: true,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("z_getoperationresult"), {
      kind: "privileged",
      highRisk: false,
    });
  });

  it("routes every audited secret-bearing result to backend-only file output", function () {
    for (const method of [
      "convertpassphrase",
      "decryptdata",
      "dumpprivkey",
      "registernamecommitment",
      "signdata",
      "z_exportkey",
      "z_exportviewingkey",
      "z_getencryptionaddress",
      "z_getpaymentdisclosure",
      "z_listreceivedbyaddress",
      "z_listunspent",
      "z_validatepaymentdisclosure",
      "z_viewtransaction",
      "zcrawkeygen",
      "zcrawreceive",
    ]) {
      assert.strictEqual(
        classifyTerminalRpcMethod(method).kind,
        "sensitive-output",
        `${method} must not return to the renderer`
      );
    }

    assert.strictEqual(classifyTerminalRpcMethod("signdata").highRisk, true);
    assert.strictEqual(classifyTerminalRpcMethod("registernamecommitment").highRisk, true);
  });

  it("allows future methods only with strongest confirmation and save-only output", function () {
    assert.deepStrictEqual(classifyTerminalRpcMethod("future_wallet_rpc"), {
      kind: "sensitive-output",
      highRisk: true,
    });
    assert.deepStrictEqual(classifyTerminalRpcMethod("getwalletseed"), {
      kind: "sensitive-output",
      highRisk: true,
    });
  });

  it("deeply snapshots only executable request fields and rejects malformed JSON values", function () {
    const body = {
      chainTicker: "VRSC",
      cmd: "sendcurrency",
      params: [{ amount: 1, nested: [true] }],
      approved: true,
      classification: "read-only",
      savePath: "/tmp/attacker",
    };
    const request = createTerminalRpcRequest(body);

    body.chainTicker = "ATTACKER";
    body.params[0].amount = 999;
    body.params[0].nested.push(false);

    assert.strictEqual(request.chainTicker, "VRSC");
    assert.strictEqual(request.method, "sendcurrency");
    assert.deepStrictEqual(request.params, [{ amount: 1, nested: [true] }]);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(request, "approved"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(request, "savePath"), false);
    assert.strictEqual(Object.isFrozen(request), true);
    assert.strictEqual(Object.isFrozen(request.params[0].nested), true);

    assert.throws(
      () => createTerminalRpcRequest({ chainTicker: "VRSC;stop", cmd: "getinfo", params: [] }),
      /Invalid chain/
    );
    assert.throws(
      () => createTerminalRpcRequest({ chainTicker: "VRSC", cmd: "GetInfo", params: [] }),
      /Invalid chain or daemon RPC request/
    );
    assert.throws(
      () => createTerminalRpcRequest({ chainTicker: "VRSC", cmd: "getinfo", params: [NaN] }),
      /finite numbers/
    );
    assert.throws(
      () => createTerminalRpcRequest({ chainTicker: "VRSC", cmd: "getinfo", params: [1n] }),
      /JSON values/
    );
    assert.throws(
      () => createTerminalRpcRequest({
        chainTicker: "VRSC",
        cmd: "getinfo",
        params: ["x".repeat(256 * 1024)],
      }),
      /too large/
    );
  });

  it("redacts positional and nested secrets while preserving safe decoded arguments", function () {
    const request = createTerminalRpcRequest({
      chainTicker: "VRSC",
      cmd: "signrawtransaction",
      params: [
        "raw-transaction-hex",
        [{ txid: "abc", vout: 0 }],
        ["L-private-key"],
        {
          metadata: {
            walletPassphrase: "do-not-display",
            customWif: "custom-wif-do-not-display",
            apiKey: "api-key-do-not-display",
            amount: 12,
          },
        },
      ],
    });

    assert.deepStrictEqual(redactTerminalRpcParams(request), [
      "raw-transaction-hex",
      [{ txid: "abc", vout: 0 }],
      REDACTED_VALUE,
      {
        metadata: {
          walletPassphrase: REDACTED_VALUE,
          customWif: REDACTED_VALUE,
          apiKey: REDACTED_VALUE,
          amount: 12,
        },
      },
    ]);

    const displayed = formatTerminalRpcRequest(request);
    assert.match(displayed, /raw-transaction-hex/);
    assert.match(displayed, /"amount": 12/);
    assert.doesNotMatch(
      displayed,
      /L-private-key|do-not-display|custom-wif-do-not-display|api-key-do-not-display/
    );

    const mergeRequest = createTerminalRpcRequest({
      chainTicker: "VRSC",
      cmd: "addmergedblock",
      params: ["hex", "PBaaS", "127.0.0.1", 27486, "rpc-user:rpc-password"],
    });
    const mergeDisplay = formatTerminalRpcRequest(mergeRequest);
    assert.match(mergeDisplay, /PBaaS/);
    assert.doesNotMatch(mergeDisplay, /rpc-user|rpc-password/);

    const identityRequest = createTerminalRpcRequest({
      chainTicker: "VRSC",
      cmd: "registeridentity",
      params: [{ namereservation: { name: "Alice", salt: "unrevealed-salt" } }],
    });
    const identityDisplay = formatTerminalRpcRequest(identityRequest);
    assert.match(identityDisplay, /Alice/);
    assert.doesNotMatch(identityDisplay, /unrevealed-salt/);
  });

  it("renders bidirectional and invisible parameter characters as visible escapes", function () {
    const request = createTerminalRpcRequest({
      chainTicker: "VRSC",
      cmd: "stop",
      params: ["safe\u202eTXE", "line\nfeed"],
    });
    const displayed = formatTerminalRpcRequest(request);

    assert.match(displayed, /safe\\\\u202eTXE/);
    assert.match(displayed, /line\\\\u000afeed/);
    assert.strictEqual(displayed.includes("\u202e"), false);
  });

  it("accepts only bounded lowercase daemon method syntax", function () {
    assert.strictEqual(isValidRpcMethod("z_sendmany"), true);
    assert.strictEqual(isValidRpcMethod("getinfo"), true);
    assert.strictEqual(isValidRpcMethod("GetInfo"), false);
    assert.strictEqual(isValidRpcMethod("stop;touch"), false);
    assert.strictEqual(isValidRpcMethod(""), false);
    assert.strictEqual(isValidRpcMethod(`a${"b".repeat(128)}`), false);
  });
});
