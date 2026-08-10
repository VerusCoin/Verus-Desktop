"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const createApi = () => {
  const routes = new Map();
  const api = {
    electrum: {},
    setPost(route, handler, forceEncryption) {
      routes.set(route, { handler, forceEncryption });
    },
  };

  require("../routes/api/electrum/send")(api);
  return { api, routes };
};

const invokeRoute = (handler, body) =>
  new Promise((resolve, reject) => {
    try {
      const pending = handler(
        { body },
        {
          send(value) {
            resolve(JSON.parse(value));
            return this;
          },
        },
        reject
      );
      if (pending && typeof pending.catch === "function") pending.catch(reject);
    } catch (error) {
      reject(error);
    }
  });

describe("Electrum transaction preflight boundary", function () {
  it("returns only confirmation fields and cannot request transaction signing", async function () {
    const { api, routes } = createApi();
    const registration = routes.get("/electrum/tx_preflight");
    let preflightArguments;

    api.electrum.txPreflight = async (...args) => {
      preflightArguments = args;
      return {
        chainTicker: "VRSC",
        to: "RDestination",
        from: "RSource",
        balance: 10,
        value: 1,
        fee: 0.0001,
        feePerByte: 2,
        total: 1.0001,
        remainingBalance: 8.9999,
        warnings: [{ field: "value", message: "test warning" }],
        interest: null,
        rawTx: "signed-transaction",
        unsignedTransaction: "private-signing-artifact",
        privateKey: "private-key",
        signingData: { inputs: ["secret-input"] },
      };
    };

    const customUtxos = [{ txid: "a".repeat(64), vout: 0 }];
    const response = await invokeRoute(registration.handler, {
      chainTicker: "VRSC",
      toAddress: "RDestination",
      amount: 1,
      verify: true,
      lumpFee: 0.0001,
      feePerByte: 2,
      noSigature: false,
      offlineTx: false,
      unsigned: true,
      customUtxos,
      votingTx: true,
      opreturn: "private-data",
      customWif: "caller-private-key",
      customFromAddress: "RSource",
    });

    assert.strictEqual(registration.forceEncryption, true);
    assert.strictEqual(preflightArguments[6], true, "public preflight must force no-signature mode");
    assert.strictEqual(preflightArguments[7], false);
    assert.strictEqual(preflightArguments[8], false);
    assert.strictEqual(preflightArguments[9], customUtxos);
    assert.strictEqual(preflightArguments[10], false);
    assert.strictEqual(preflightArguments[11], undefined);
    assert.strictEqual(preflightArguments[12], undefined);
    assert.strictEqual(preflightArguments[13], "RSource");
    assert.deepStrictEqual(response, {
      msg: "success",
      result: {
        chainTicker: "VRSC",
        to: "RDestination",
        from: "RSource",
        balance: 10,
        value: 1,
        fee: 0.0001,
        feePerByte: 2,
        total: 1.0001,
        remainingBalance: 8.9999,
        warnings: [{ field: "value", message: "test warning" }],
        interest: null,
      },
    });
    assert.doesNotMatch(
      JSON.stringify(response),
      /signed-transaction|private-signing-artifact|private-key|secret-input/
    );
  });

  it("keeps signed transaction creation and broadcast inside sendtx", async function () {
    const { api, routes } = createApi();
    const registration = routes.get("/electrum/sendtx");
    const signedTransaction = "signed-transaction-for-broadcast";
    const txid = "b".repeat(64);
    let preflightArguments;
    let broadcastValue;
    let pendingCache;

    api.electrum.txPreflight = async (...args) => {
      preflightArguments = args;
      return {
        chainTicker: "VRSC",
        from: "RSource",
        rawTx: signedTransaction,
        value: 1,
      };
    };
    api.validateChainTicker = () => "VRSC";
    api.ecl = async () => ({
      blockchainTransactionBroadcast(rawTx) {
        broadcastValue = rawTx;
        return Promise.resolve(txid);
      },
    });
    api.updatePendingTxCache = (...args) => {
      pendingCache = args;
    };

    const response = await invokeRoute(registration.handler, {
      chainTicker: "VRSC",
      toAddress: "RDestination",
      amount: 1,
      noSigature: false,
      customWif: "send-only-private-key",
    });

    assert.strictEqual(registration.forceEncryption, true);
    assert.strictEqual(preflightArguments[6], false);
    assert.strictEqual(preflightArguments[12], "send-only-private-key");
    assert.strictEqual(broadcastValue, signedTransaction);
    assert.strictEqual(pendingCache[0], "VRSC");
    assert.strictEqual(pendingCache[1], txid);
    assert.strictEqual(pendingCache[2].rawtx, signedTransaction);
    assert.deepStrictEqual(response, {
      msg: "success",
      result: {
        chainTicker: "VRSC",
        from: "RSource",
        rawTx: signedTransaction,
        value: 1,
        txid,
      },
    });
  });

  it("does not read the wallet private key in internal no-signature mode", async function () {
    const { api } = createApi();
    let privateKeyReads = 0;

    api.validateChainTicker = () => "BTC";
    api.electrum.coinData = { btc: { nspv: false } };
    api.electrumServers = { btc: { txfee: 1000 } };
    api.electrumKeys = {
      btc: {
        pub: "RSource",
        get priv() {
          privateKeyReads += 1;
          return "private-key";
        },
      },
    };
    api.ecl = async () => ({});
    api.log = () => {};
    api.electrum.listunspent = async () => [
      {
        txid: "c".repeat(64),
        vout: 0,
        amountSats: 100000,
        confirmations: 2,
        verified: true,
        height: 1,
        currentHeight: 2,
      },
    ];

    const result = await api.electrum.txPreflight(
      "BTC",
      "RDestination",
      0.0005,
      true,
      1000,
      undefined,
      true
    );

    assert.strictEqual(privateKeyReads, 0);
    assert.strictEqual(result.rawTx, undefined);
    assert.strictEqual(result.value, 0.0005);
    assert.strictEqual(result.fee, 0.00001);
  });
});
