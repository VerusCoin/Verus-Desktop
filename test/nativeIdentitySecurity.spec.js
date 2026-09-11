"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const singleIdentity = {
  name: "alice",
  primaryaddresses: ["Rowner"],
  minimumsignatures: 1,
  parent: "iparent",
  identityaddress: "iidentity",
  version: 3,
};
const updateArgs = ["VRSC", "alice@", ["Rnew"], 1, null, "irevoke", "irecover"];
const operations = [
  ["update_id", updateArgs, "updateidentity"],
  ["recover_id", updateArgs, "recoveridentity"],
  ["update_id_preflight", updateArgs, null],
  ["recover_id_preflight", updateArgs, null],
  ["revoke_id", ["VRSC", "alice@"], "revokeidentity"],
  ["setidentitytimelock", ["VRSC", "alice@", { unlockatblock: 100 }], "setidentitytimelock"],
];

const createApi = (identity = singleIdentity) => {
  const context = { identity, calls: [], routes: new Map() };
  context.api = {
    native: {
      async callDaemon(coin, method, params) {
        context.calls.push({ coin, method, params });
        return method === "getidentity" ? { identity: context.identity } : "result-txid";
      },
    },
    setPost(route, handler) { context.routes.set(route, handler); },
  };
  for (const module of ["idUpdate", "idRecovery", "idRevocation", "setidentitytimelock"]) {
    require(`../routes/api/native/${module}`)(context.api);
  }
  return context;
};

describe("Desktop identity mutation restrictions", function () {
  for (const [operation, args, mutation] of operations) {
    it(`${operation} refuses existing multisig or malformed identities without mutation`, async function () {
      for (const identity of [
        { ...singleIdentity, primaryaddresses: ["Rone", "Rtwo", "Rthree"], minimumsignatures: 2 },
        { ...singleIdentity, primaryaddresses: ["Rone", "Rtwo", "Rthree"] },
        { ...singleIdentity, minimumsignatures: 2 },
        { ...singleIdentity, primaryaddresses: [] },
        {},
        null,
      ]) {
        const { api, calls } = createApi(identity);
        await assert.rejects(api.native[operation](...args), /Use the CLI/);
        assert.deepStrictEqual(calls.map(call => call.method), ["getidentity"]);
      }
    });

    it(`${operation} preserves supported single-signature behavior`, async function () {
      const { api, calls } = createApi();
      const result = await api.native[operation](...args);
      assert.deepStrictEqual(calls[0], {
        coin: "VRSC", method: "getidentity", params: ["alice@"],
      });
      assert.deepStrictEqual(
        calls.map(call => call.method),
        mutation ? ["getidentity", mutation] : ["getidentity"]
      );
      if (operation.startsWith("update") || operation.startsWith("recover")) {
        assert.deepStrictEqual(result.primaryaddresses, ["Rnew"]);
        assert.strictEqual(result.minimumsignatures, 1);
      }
    });
  }

  it("rejects proposed multisig policies in both preview and execution", async function () {
    for (const operation of ["update_id", "recover_id", "update_id_preflight", "recover_id_preflight"]) {
      for (const [addresses, threshold] of [[["Rone", "Rtwo"], 1], [["Rone", "Rtwo"], 2]]) {
        const { api, calls } = createApi();
        await assert.rejects(
          api.native[operation]("VRSC", "alice@", addresses, threshold),
          /Use the CLI/
        );
        assert.deepStrictEqual(calls.map(call => call.method), ["getidentity"]);
      }
    }
  });

  it("rechecks identity control at execution after a successful preview", async function () {
    for (const operation of ["update_id", "recover_id"]) {
      const context = createApi();
      await context.api.native[`${operation}_preflight`](...updateArgs);
      context.identity = { ...singleIdentity, primaryaddresses: ["Rone", "Rtwo"], minimumsignatures: 2 };
      await assert.rejects(context.api.native[operation](...updateArgs), /Use the CLI/);
      assert.deepStrictEqual(context.calls.map(call => call.method), ["getidentity", "getidentity"]);
    }
  });

  it("returns the CLI instruction through the existing GUI route error response", async function () {
    const { routes, calls } = createApi({ ...singleIdentity, primaryaddresses: ["Rone", "Rtwo"] });
    const response = await new Promise(resolve => {
      routes.get("/native/update_id_preflight")(
        { body: { chainTicker: "VRSC", name: "alice@", primaryaddresses: ["Rnew"], minimumsignatures: 1 } },
        { send: value => resolve(JSON.parse(value)) }
      );
    });
    assert.strictEqual(response.msg, "error");
    assert.match(response.result, /Use the CLI/);
    assert.deepStrictEqual(calls.map(call => call.method), ["getidentity"]);
  });
});

describe("Identity mutation targets", function () {
  const nestedIdentity = {
    ...singleIdentity,
    identityaddress: "iJNxjMMUDM2hnGrzWZHdY8QnPEF713uypT",
    parent: "inestedparent",
  };

  for (const [operation, mutation] of [["update_id", "updateidentity"], ["recover_id", "recoveridentity"]]) {
    for (const [target, identity] of [
      [nestedIdentity.identityaddress, nestedIdentity],
      ["alice.subname.outer@", nestedIdentity],
      ["alice@", singleIdentity],
    ]) {
      it(`${operation} uses the resolved raw name and parent for ${target}`, async function () {
        const { api, calls } = createApi(identity);
        const args = [...updateArgs];
        args[1] = target;

        const preview = await api.native[`${operation}_preflight`](...args);
        const result = await api.native[operation](...args);

        assert.strictEqual(preview.name, target);
        assert.deepStrictEqual(calls.slice(0, 2), [
          { coin: "VRSC", method: "getidentity", params: [target] },
          { coin: "VRSC", method: "getidentity", params: [target] },
        ]);
        assert.strictEqual(calls[2].method, mutation);
        const [updatedIdentity] = calls[2].params;
        assert.strictEqual(updatedIdentity.name, identity.name);
        assert.strictEqual(updatedIdentity.parent, identity.parent);
        assert.strictEqual(updatedIdentity.identityaddress, identity.identityaddress);
        assert.strictEqual(result.name, identity.name);
        assert.strictEqual(result.identityaddress, identity.identityaddress);
      });
    }
  }

  it("passes the selected nested identity address unchanged to revocation", async function () {
    const { api, calls } = createApi(nestedIdentity);
    const result = await api.native.revoke_id("VRSC", nestedIdentity.identityaddress);

    assert.deepStrictEqual(calls, [
      { coin: "VRSC", method: "getidentity", params: [nestedIdentity.identityaddress] },
      { coin: "VRSC", method: "revokeidentity", params: [nestedIdentity.identityaddress] },
    ]);
    assert.strictEqual(result.name, nestedIdentity.identityaddress);
  });
});
