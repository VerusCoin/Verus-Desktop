"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const registerRoute = (authorizationOutcome) => {
  let registration;
  const authorizationRequests = [];
  const api = {
    appConfig: { general: { electrum: { allowInsecureTcp: false } } },
    customKomodoNetworks: {},
    electrum: { coinData: {} },
    electrumKeys: {},
    electrumServers: {},
    nativeAuthorization: {
      async authorize(request) {
        authorizationRequests.push(request);
        return authorizationOutcome;
      },
    },
    setPost(route, handler, forceEncryption) {
      if (route === "/electrum/coins/activate") {
        registration = { handler, forceEncryption };
      }
    },
  };
  require("../routes/api/electrum/coins")(api);
  return { api, authorizationRequests, registration };
};

const invoke = async (handler, body) => {
  let response;
  await handler(
    { body },
    { send(value) { response = JSON.parse(value); return this; } },
    () => {}
  );
  return response;
};

describe("custom Electrum server authorization", function () {
  it("uses the shared coordinator and does not activate after cancellation", async function () {
    const { api, authorizationRequests, registration } = registerRoute({ status: "cancelled" });
    let activations = 0;
    api.addElectrumCoin = async () => {
      activations += 1;
      return true;
    };

    const response = await invoke(registration.handler, {
      chainTicker: "VRSC",
      launchConfig: {
        customServers: ["electrum.example.org:50002:ssl"],
        tags: [],
        txFee: 1000,
      },
    });

    assert.strictEqual(registration.forceEncryption, true);
    assert.strictEqual(activations, 0);
    assert.strictEqual(authorizationRequests.length, 1);
    assert.strictEqual(authorizationRequests[0].scope, "security-decision");
    assert.strictEqual(
      authorizationRequests[0].actionId,
      "/electrum/coins/activate:custom-servers"
    );
    assert.match(authorizationRequests[0].detail, /electrum\.example\.org:50002:ssl/);
    assert.match(response.result, /cancelled/i);
  });

  it("keeps official activation prompt-free and validates custom endpoints before prompting", async function () {
    const { api, authorizationRequests, registration } = registerRoute({
      status: "approved",
      operationId: "custom-server-approval",
    });
    const activations = [];
    api.addElectrumCoin = async (...args) => {
      activations.push(args);
      return true;
    };

    assert.deepStrictEqual(await invoke(registration.handler, {
      chainTicker: "VRSC",
      launchConfig: { customServers: [], tags: ["is_komodo"], txFee: 1000 },
    }), { msg: "success", result: true });
    assert.strictEqual(authorizationRequests.length, 0);
    assert.strictEqual(activations.length, 1);

    const invalid = await invoke(registration.handler, {
      chainTicker: "VRSC",
      launchConfig: {
        customServers: ["not a valid endpoint"],
        tags: [],
        txFee: 1000,
      },
    });
    assert.strictEqual(authorizationRequests.length, 0);
    assert.strictEqual(activations.length, 1);
    assert.strictEqual(invalid.msg, "error");

    const invalidTicker = await invoke(registration.handler, {
      chainTicker: "VRSC\nAuthorize everything",
      launchConfig: {
        customServers: ["electrum.example.org:50002:ssl"],
        tags: [],
        txFee: 1000,
      },
    });
    assert.strictEqual(authorizationRequests.length, 0);
    assert.strictEqual(activations.length, 1);
    assert.strictEqual(invalidTicker.msg, "error");
  });
});
