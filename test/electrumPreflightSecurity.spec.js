"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const bitcoin = require("bitgo-utxo-lib");
const networks = require("agama-wallet-lib/src/bitcoinjs-networks");
const decodeTransaction = require("agama-wallet-lib/src/transaction-decoder");

// Unsigned synthetic previous transactions; no wallet keys or network access.
const previousTransaction = (network = networks.btc, { witness = false, sapling = false } = {}) => {
  const tx = new bitcoin.Transaction(network);
  if (sapling) {
    tx.version = 4;
    tx.overwintered = 1;
    tx.versionGroupId = 0x892f2085;
  }
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(Buffer.from("51", "hex"), 100000);
  if (witness) tx.setWitness(0, [Buffer.from("00", "hex")]);
  return { txid: tx.getId(), raw: tx.toHex() };
};

const createApi = () => {
  const routes = new Map();
  const api = {
    electrum: {},
    setPost(route, handler, forceEncryption) {
      routes.set(route, { handler, forceEncryption });
    },
    setGet(route, handler) {
      routes.set(route, { handler });
    },
  };

  require("../routes/api/electrum/send")(api);
  return { api, routes };
};

const createInputValidationApi = () => {
  const fixture = createApi();
  const { api } = fixture;
  const previous = previousTransaction();
  const utxo = {
    txid: previous.txid,
    vout: 0,
    amountSats: 100000,
    confirmations: 2,
    verified: true,
    height: 1,
    currentHeight: 3,
  };
  let privateKeyReads = 0;
  let broadcasts = 0;
  api.validateChainTicker = () => "BTC";
  api.electrum.coinData = { btc: { nspv: false } };
  api.electrumServers = { btc: { txfee: 1000 } };
  api.electrumKeys = {
    btc: {
      pub: "RSource",
      get priv() {
        privateKeyReads += 1;
        throw new Error("Tests must not reach signing");
      },
    },
  };
  api.ecl = async () => ({
    blockchainTransactionBroadcast() {
      broadcasts += 1;
      throw new Error("Tests must not reach broadcast");
    },
  });
  api.getTransaction = async () => previous.raw;
  api.getNetworkData = (chain) => networks[chain.toLowerCase()];
  api.electrumJSTxDecoder = (raw, chain, network) => decodeTransaction(raw, network);
  api.electrum.listunspent = async () => [utxo];
  api.log = () => {};
  return { ...fixture, previous, utxo, privateKeyReads: () => privateKeyReads, broadcasts: () => broadcasts };
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
    const previous = previousTransaction();
    api.getTransaction = async () => previous.raw;
    api.getNetworkData = () => networks.btc;
    api.electrumJSTxDecoder = (raw, chain, network) => decodeTransaction(raw, network);
    api.electrum.listunspent = async () => [
      {
        txid: previous.txid,
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

describe("Electrum input amount verification", function () {
  it("uses real decoded output amounts for BTC, witness and Sapling transactions", async function () {
    const { api } = createInputValidationApi();
    for (const [network, options, chain] of [
      [networks.btc, {}, "BTC"],
      [networks.btc, { witness: true }, "BTC"],
      [networks.kmd, { sapling: true }, "KMD"],
    ]) {
      const previous = previousTransaction(network, options);
      api.getTransaction = async () => previous.raw;
      const [result] = await api.electrum.conditionalListunspent([
        { txid: previous.txid, vout: 0, amountSats: "100000", confirmations: 2 },
      ], {}, "RSource", chain, true, true);
      assert.strictEqual(result.amountSats, 100000);
      assert.strictEqual(result.amount, 0.001);
    }
  });

  for (const custom of [false, true]) {
    it(`rejects understated ${custom ? "custom" : "server"} amounts before signing or broadcast`, async function () {
      const fixture = createInputValidationApi();
      fixture.utxo.amountSats = 90000;
      const response = await invokeRoute(fixture.routes.get("/electrum/sendtx").handler, {
        chainTicker: "BTC",
        toAddress: "RDestination",
        amount: 0.0005,
        verify: true,
        ...(custom ? { customUtxos: [fixture.utxo] } : {}),
      });
      assert.strictEqual(response.msg, "error");
      assert.match(response.result, /amount does not match previous output/);
      assert.strictEqual(fixture.privateKeyReads(), 0);
      assert.strictEqual(fixture.broadcasts(), 0);
    });
  }

  it("rejects an invalid output index, transaction hash or raw transaction", async function () {
    for (const mutation of [
      { vout: -1 }, { vout: 1 }, { vout: 0.5 },
      { txid: "f".repeat(64) }, { txid: "invalid" },
      { amountSats: 100001 }, { amountSats: null }, { amountSats: true },
    ]) {
      const { api, utxo } = createInputValidationApi();
      await assert.rejects(api.electrum.conditionalListunspent(
        [{ ...utxo, ...mutation }], {}, "RSource", "BTC", true, true
      ), /Invalid|does not match/);
    }
    for (const raw of [null, "not-hex", "01", "00".repeat(61)]) {
      const { api, utxo } = createInputValidationApi();
      api.getTransaction = async () => raw;
      await assert.rejects(api.electrum.conditionalListunspent(
        [utxo], {}, "RSource", "BTC", true, true
      ));
    }
  });

  it("rejects array-like custom inputs before signing or broadcast", async function () {
    const fixture = createInputValidationApi();
    const response = await invokeRoute(fixture.routes.get("/electrum/sendtx").handler, {
      chainTicker: "BTC",
      toAddress: "RDestination",
      amount: 0.0005,
      customUtxos: { 0: { ...fixture.utxo, amountSats: 90000 }, length: 1 },
    });
    assert.strictEqual(response.msg, "error");
    assert.match(response.result, /inputs must be an array/);
    assert.strictEqual(fixture.privateKeyReads(), 0);
    assert.strictEqual(fixture.broadcasts(), 0);
  });

  it("propagates list and previous-transaction failures instead of hanging", async function () {
    const { api, utxo } = createInputValidationApi();
    api.electrum.listunspent = async () => { throw new Error("list failed"); };
    await assert.rejects(api.electrum.txPreflight(
      "BTC", "RDestination", 0.0005, true, 1000, undefined, true
    ), /list failed/);
    api.getTransaction = async () => { throw new Error("previous transaction failed"); };
    await assert.rejects(api.electrum.conditionalListunspent(
      [utxo], {}, "RSource", "BTC", true, true
    ), /previous transaction failed/);
  });

  it("propagates raw transaction fetch failures through the cache and full UTXO list", async function () {
    const { api, previous } = createInputValidationApi();
    api.electrumCache = {};
    api.dpowCoins = [];
    api.electrumGetCurrentBlock = async () => 3;
    require("../routes/api/electrum/cache")(api);
    require("../routes/api/electrum/listunspent")(api);
    const ecl = {
      blockchainAddressListunspent: async () => [
        { tx_hash: previous.txid, tx_pos: 0, value: 100000, height: 1 },
      ],
      blockchainTransactionGet: async () => { throw new Error("fetch failed"); },
    };
    await assert.rejects(api.electrum.conditionalListunspent(
      false, ecl, "RSource", "BTC", true, false
    ), /fetch failed/);
  });
});
