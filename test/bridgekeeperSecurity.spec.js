const assert = require("assert");
const { describe, it } = require("node:test");
const http = require("http");

describe("Bridgekeeper network boundary", () => {
  it("returns only the public ethnode setting through the Desktop API", async () => {
    const confFile = require("verus_bridgekeeper/confFile");
    const originalLoadConfFile = confFile.loadConfFile;
    let getConfRoute;
    let forceEncryption;

    try {
      confFile.loadConfFile = () => ({
        ethnode: "https://ethereum.example.invalid/project-id",
        privatekey: "bridgekeeper-private-key",
        rpcuser: "rpc-user",
        rpcpassword: "rpc-password",
        ethcontract: "0x1234",
      });

      const api = {
        native: {},
        setPost(route, handler, encrypted) {
          if (route === "/native/bridgekeeper_getconf") {
            getConfRoute = handler;
            forceEncryption = encrypted;
          }
        },
      };
      require("../routes/api/native/verusbridge/verusbridge")(api);

      assert.deepStrictEqual(await api.native.bridgekeeper_getconf("VRSC"), {
        ethnode: "https://ethereum.example.invalid/project-id",
      });
      assert.strictEqual(forceEncryption, true);

      let response;
      await getConfRoute(
        { body: { chainTicker: "VRSC" } },
        { send(value) { response = JSON.parse(value); } },
        () => {}
      );
      assert.deepStrictEqual(response, {
        msg: "success",
        result: { ethnode: "https://ethereum.example.invalid/project-id" },
      });
      assert.deepStrictEqual(Object.keys(response.result), ["ethnode"]);
      assert.doesNotMatch(JSON.stringify(response), /private-key|rpc-user|rpc-password|ethcontract/);
    } finally {
      confFile.loadConfFile = originalLoadConfFile;
    }
  });

  it("binds to loopback and ignores spoofed forwarding headers", async () => {
    const bridgekeeperPath = require.resolve("verus_bridgekeeper");
    const interactorPath = require.resolve("verus_bridgekeeper/ethInteractor.js");
    const originalCreateServer = http.createServer;
    const originalBridgekeeper = require.cache[bridgekeeperPath];
    const originalInteractor = require.cache[interactorPath];
    let requestHandler;
    let listenArguments;

    const fakeServer = {
      listening: false,
      listen(...args) {
        listenArguments = args;
        this.listening = true;
      },
      close() {
        this.listening = false;
      },
    };

    try {
      http.createServer = (handler) => {
        requestHandler = handler;
        return fakeServer;
      };
      require.cache[interactorPath] = {
        id: interactorPath,
        filename: interactorPath,
        loaded: true,
        exports: {
          init: async () => 17776,
          end() {},
          web3status: async () => true,
          InteractorConfig: {
            _userpass: "rpc-user:rpc-password",
            _rpcallowip: "127.0.0.1",
            _consolelog: false,
          },
        },
      };
      delete require.cache[bridgekeeperPath];

      const bridgekeeper = require(bridgekeeperPath);
      assert.strictEqual(await bridgekeeper.start({ ticker: "VRSC" }), true);
      assert.deepStrictEqual(listenArguments, [17776, "127.0.0.1"]);

      const makeResponse = () => ({
        statusCode: null,
        body: "",
        writeHead(statusCode) {
          this.statusCode = statusCode;
          return this;
        },
        end(body = "") {
          this.body += body;
        },
      });
      const response = makeResponse();
      requestHandler(
        {
          headers: {
            authorization: `Basic ${Buffer.from("rpc-user:rpc-password").toString("base64")}`,
            "x-forwarded-for": "127.0.0.1",
          },
          socket: { remoteAddress: "192.0.2.10" },
          connection: { remoteAddress: "192.0.2.10" },
          method: "GET",
        },
        response
      );

      assert.strictEqual(response.statusCode, 401);
      assert.match(response.body, /Unauthorized/);

      const localResponse = makeResponse();
      requestHandler(
        {
          headers: {
            authorization: `Basic ${Buffer.from("rpc-user:rpc-password").toString("base64")}`,
          },
          socket: { remoteAddress: "127.0.0.1" },
          connection: { remoteAddress: "127.0.0.1" },
          method: "GET",
        },
        localResponse
      );

      assert.strictEqual(localResponse.statusCode, 200);
      assert.strictEqual(localResponse.body, "");
    } finally {
      http.createServer = originalCreateServer;
      delete require.cache[bridgekeeperPath];
      if (originalBridgekeeper) require.cache[bridgekeeperPath] = originalBridgekeeper;
      if (originalInteractor) require.cache[interactorPath] = originalInteractor;
      else delete require.cache[interactorPath];
    }
  });
});
