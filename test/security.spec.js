const assert = require("assert");
const { describe, it } = require("node:test");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const blake2b = require("blake2b");
const CryptoJS = require("crypto-js");

const approvingSensitiveDataService = () => ({
  execute: async (request, reveal) => ({ status: "ok", result: await reveal(request) }),
});

const createAuthApi = () => {
  const api = {
    appConfig: { general: { main: {} } },
    get() {},
    post() {},
    rpcCalls: { GET: {}, POST: {} },
  };
  return require("../routes/api/auth")(api);
};

describe("security regressions", function () {
  describe("API authentication", function () {
    it("rejects the empty BLAKE2 digest for non-builtin callers", function () {
      const api = createAuthApi();
      api.BuiltinSecret = "test-secret";
      const emptyDigest =
        "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419" +
        "d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce";

      assert.strictEqual(
        api.checkToken(emptyDigest, "native/call_daemon", Date.now(), {
          id: "ATTACKER",
          builtin: false,
        }),
        false
      );
    });

    it("accepts a valid builtin token once and rejects replay", function () {
      const api = createAuthApi();
      api.BuiltinSecret = "test-secret";
      const time = Date.now();
      const id = "VERUS_DESKTOP_MAIN";
      const makeToken = (requestPath) => {
        const hash = blake2b(64);
        for (const value of [String(time), api.BuiltinSecret, requestPath, id]) {
          hash.update(Buffer.from(value));
        }
        return hash.digest("hex");
      };
      const requestPath = "native/get_info";
      const token = makeToken(requestPath);

      assert.strictEqual(api.checkToken(token, requestPath, time, { id, builtin: true }), true);
      assert.strictEqual(
        api.checkToken(makeToken("native/get_block"), "native/get_block", time, { id, builtin: true }),
        true
      );
      assert.throws(
        () => api.checkToken(token.toUpperCase(), requestPath, time, { id, builtin: true }),
        /Cannot repeat call/
      );
    });

    it("catches asynchronous route failures and preserves response methods", async function () {
      let wrappedHandler;
      let responseStatus = 200;
      let responseBody;
      const api = {
        appConfig: { general: { main: { livelog: false } } },
        get() {},
        post(route, handler) { wrappedHandler = handler; },
        rpcCalls: { GET: {}, POST: {} },
        log() {},
      };
      require("../routes/api/auth")(api);
      api.setPost("/help", async (req, res) => {
        await Promise.resolve();
        res.status(202);
        throw new Error("async route failed");
      });

      const response = {
        type() {},
        status(value) { responseStatus = value; return this; },
        send(value) { responseBody = JSON.parse(value); },
      };
      await wrappedHandler(
        { body: { payload: {}, encrypted: false } },
        response,
        () => {}
      );

      assert.strictEqual(responseStatus, 202);
      assert.match(JSON.parse(responseBody.payload).result, /async route failed/);

      responseStatus = 200;
      responseBody = null;
      api.setPost("/help", async (req, res) => {
        await Promise.resolve();
        return res.status(201).send("wrapped response");
      });
      await wrappedHandler(
        { body: { payload: {}, encrypted: false } },
        response,
        () => {}
      );
      assert.strictEqual(responseStatus, 201);
      assert.strictEqual(responseBody.payload, "wrapped response");
    });

    it("returns synchronous route failures in the requested encrypted envelope", async function () {
      let wrappedHandler;
      let responseBody;
      const api = {
        appConfig: { general: { main: { livelog: false } } },
        BuiltinSecret: "test-secret",
        get() {},
        post(route, handler) { wrappedHandler = handler; },
        rpcCalls: { GET: {}, POST: {} },
        log() {},
        native: {
          captureStartupSecurityState() {
            return {
              chainWriting: false,
              fingerprint: "a".repeat(64),
            };
          },
        },
      };
      require("../routes/api/auth")(api);

      const route = "/native/coins/activate";
      const requestPath = "native/coins/activate";
      const time = Date.now();
      const appId = "VERUS_DESKTOP_MAIN";
      const hash = blake2b(64);
      for (const value of [String(time), api.BuiltinSecret, requestPath, appId]) {
        hash.update(Buffer.from(value));
      }

      api.setPost(route, () => {
        throw new Error("synchronous activation failure");
      }, true);

      const response = {
        headersSent: false,
        type() {},
        status() { return this; },
        send(value) {
          this.headersSent = true;
          responseBody = JSON.parse(value);
        },
      };
      await wrappedHandler(
        {
          body: {
            app_id: appId,
            builtin: true,
            encrypted: true,
            payload: CryptoJS.AES.encrypt(
              JSON.stringify({}),
              api.BuiltinSecret
            ).toString(),
            time,
            validity_key: hash.digest("hex"),
          },
        },
        response,
        () => {}
      );

      const plaintext = CryptoJS.AES.decrypt(
        responseBody.payload,
        api.BuiltinSecret
      ).toString(CryptoJS.enc.Utf8);
      assert.deepStrictEqual(JSON.parse(plaintext), {
        msg: "error",
        result: "synchronous activation failure",
      });
    });

    it("keeps encrypted framing for encrypted request decoding errors", async function () {
      let handlerCalled = false;
      let responseBody;
      let responseStatus = 200;
      let wrappedHandler;
      const api = {
        appConfig: { general: { main: { livelog: false } } },
        BuiltinSecret: "test-secret",
        get() {},
        post(route, handler) { wrappedHandler = handler; },
        rpcCalls: { GET: {}, POST: {} },
        log() {},
      };
      require("../routes/api/auth")(api);

      const route = "/native/get_info";
      const requestPath = "native/get_info";
      const time = Date.now();
      const appId = "VERUS_DESKTOP_MAIN";
      const hash = blake2b(64);
      for (const value of [String(time), api.BuiltinSecret, requestPath, appId]) {
        hash.update(Buffer.from(value));
      }
      api.setPost(route, () => { handlerCalled = true; }, true);

      const response = {
        headersSent: false,
        type() {},
        status(value) { responseStatus = value; return this; },
        send(value) {
          this.headersSent = true;
          responseBody = JSON.parse(value);
        },
      };
      await wrappedHandler(
        {
          body: {
            app_id: appId,
            builtin: true,
            encrypted: true,
            payload: CryptoJS.AES.encrypt(
              "not valid JSON",
              api.BuiltinSecret
            ).toString(),
            time,
            validity_key: hash.digest("hex"),
          },
        },
        response,
        () => {}
      );

      const plaintext = CryptoJS.AES.decrypt(
        responseBody.payload,
        api.BuiltinSecret
      ).toString(CryptoJS.enc.Utf8);
      assert.strictEqual(handlerCalled, false);
      assert.strictEqual(responseStatus, 400);
      assert.deepStrictEqual(JSON.parse(plaintext), {
        msg: "error",
        result: "Invalid encrypted API payload",
      });
    });
  });

  describe("local HTTP boundary", function () {
    const {
      isAllowedHostHeader,
      isAllowedSocketOrigin,
      requireJsonPost,
    } = require("../routes/security/http");

    it("accepts only exact loopback Host headers on the configured port", function () {
      assert.strictEqual(isAllowedHostHeader("127.0.0.1:17775", 17775), true);
      assert.strictEqual(isAllowedHostHeader("localhost:17775", 17775), true);
      assert.strictEqual(isAllowedHostHeader("evil.example:17775", 17775), false);
      assert.strictEqual(isAllowedHostHeader("127.0.0.1:17776", 17775), false);
      assert.strictEqual(isAllowedHostHeader("evil.example@127.0.0.1:17775", 17775), false);
    });

    it("rejects form POST bodies", function () {
      let status;
      let body;
      const res = {
        status(value) { status = value; return this; },
        json(value) { body = value; return this; },
      };
      requireJsonPost(
        { method: "POST", is: () => false },
        res,
        () => assert.fail("form POST reached the API")
      );
      assert.strictEqual(status, 415);
      assert.strictEqual(body.error, "Content-Type must be application/json");
    });

    it("allows Socket.IO only from the exact renderer origin", function () {
      assert.strictEqual(isAllowedSocketOrigin("http://127.0.0.1:17775", 17775, false), true);
      assert.strictEqual(isAllowedSocketOrigin("http://evil.example", 17775, false), false);
      assert.strictEqual(isAllowedSocketOrigin(undefined, 17775, false), false);
      assert.strictEqual(isAllowedSocketOrigin("http://localhost:3000", 17775, true), true);
      assert.strictEqual(isAllowedSocketOrigin("http://localhost:3001", 17775, true), true);
      assert.strictEqual(isAllowedSocketOrigin("http://127.0.0.1:3003", 17775, true), true);
      assert.strictEqual(isAllowedSocketOrigin("http://localhost:3002", 17775, true), false);
    });
  });

  describe("configuration validation", function () {
    const template = require("../routes/appConfig").config;
    const { normalizeConfig } = require("../routes/api/utils/configValidation");

    it("rejects unknown properties and security-sensitive values", function () {
      const unknown = JSON.parse(JSON.stringify(template));
      unknown.general.main.attackerFlag = true;
      assert.throws(() => normalizeConfig(unknown, template), /not a recognized/);

      const badHost = JSON.parse(JSON.stringify(template));
      badHost.general.main.host = "0.0.0.0";
      assert.throws(() => normalizeConfig(badHost, template), /must be 127\.0\.0\.1/);

      const unencrypted = JSON.parse(JSON.stringify(template));
      unencrypted.general.main.encryptApiPost = false;
      assert.throws(() => normalizeConfig(unencrypted, template), /cannot be disabled/);

      const devMode = JSON.parse(JSON.stringify(template));
      devMode.general.main.dev = true;
      assert.throws(() => normalizeConfig(devMode, template), /command-line option/);
      assert.strictEqual(
        normalizeConfig(devMode, template, { allowDev: true }).general.main.dev,
        true
      );

      const relativeDataDir = JSON.parse(JSON.stringify(template));
      relativeDataDir.general.native.dataDir = "../../attacker";
      assert.throws(() => normalizeConfig(relativeDataDir, template), /absolute paths/);

      const invalidAuthorizationSetting = JSON.parse(JSON.stringify(template));
      invalidAuthorizationSetting.general.main.requireNativeAuthForIrreversibleActions = "false";
      assert.throws(
        () => normalizeConfig(invalidAuthorizationSetting, template),
        /must be a boolean/
      );

      const legacyWithoutAuthorizationSetting = JSON.parse(JSON.stringify(template));
      delete legacyWithoutAuthorizationSetting.general.main
        .requireNativeAuthForIrreversibleActions;
      assert.strictEqual(
        normalizeConfig(legacyWithoutAuthorizationSetting, template, { stripUnknown: true })
          .general.main.requireNativeAuthForIrreversibleActions,
        true
      );
    });

    it("strips retired settings during migration without weakening strict saves", async function () {
      const stale = JSON.parse(JSON.stringify(template));
      stale.general.main.livelog = true;
      stale.general.main.retiredSetting = true;
      stale.coin.native.dataDir["Legacy PBaaS"] = "/mnt/legacy/pbaas-wallet";
      stale.coin.native.noFastLoad["Legacy PBaaS"] = true;

      assert.throws(() => normalizeConfig(stale, template), /not a recognized/);
      const migrated = normalizeConfig(stale, template, { stripUnknown: true });
      assert.strictEqual(migrated.general.main.livelog, true);
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(migrated.general.main, "retiredSetting"),
        false
      );
      assert.strictEqual(
        migrated.coin.native.dataDir["Legacy PBaaS"],
        "/mnt/legacy/pbaas-wallet"
      );
      assert.strictEqual(migrated.coin.native.noFastLoad["Legacy PBaaS"], true);

      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-config-test-"));
      const configFile = path.join(temporaryRoot, "config.json");
      await fs.writeJson(configFile, stale);
      const originalBytes = await fs.readFile(configFile);
      const api = {
        paths: { agamaDir: temporaryRoot },
        log() {},
        setGet() {},
        setPost() {},
      };
      require("../routes/api/config")(api);
      const loaded = api.loadLocalConfig();
      assert.strictEqual(loaded.general.main.livelog, true);
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(loaded.general.main, "retiredSetting"),
        false
      );
      assert.strictEqual(
        loaded.coin.native.dataDir["Legacy PBaaS"],
        "/mnt/legacy/pbaas-wallet"
      );
      assert.deepStrictEqual(await fs.readFile(configFile), originalBytes);

      api.saveLocalAppConf(loaded);
      assert.deepStrictEqual(await fs.readJson(configFile), loaded);
      assert.deepStrictEqual(await fs.readFile(`${configFile}.bak`), originalBytes);
      await fs.remove(temporaryRoot);
    });

    it("loads a persisted dev flag only for an explicitly authorized dev launch", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-dev-config-test-"));
      const configFile = path.join(temporaryRoot, "config.json");
      const persistedDevConfig = JSON.parse(JSON.stringify(template));
      persistedDevConfig.general.main.dev = true;
      await fs.writeJson(configFile, persistedDevConfig);

      const productionApi = {
        isDevMode: false,
        paths: { agamaDir: temporaryRoot },
        log() {},
        setGet() {},
        setPost() {},
      };
      require("../routes/api/config")(productionApi);
      assert.throws(() => productionApi.loadLocalConfig(), /command-line option/);

      const developmentApi = {
        isDevMode: true,
        paths: { agamaDir: temporaryRoot },
        log() {},
        setGet() {},
        setPost() {},
      };
      require("../routes/api/config")(developmentApi);
      assert.strictEqual(developmentApi.loadLocalConfig().general.main.dev, true);
      await fs.remove(temporaryRoot);
    });

    it("enforces native approval at the persistence boundary when verification is disabled", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-config-auth-test-"));
      const currentConfig = JSON.parse(JSON.stringify(template));
      const disabledConfig = JSON.parse(JSON.stringify(template));
      disabledConfig.general.main.requireNativeAuthForIrreversibleActions = false;
      const api = {
        appConfig: currentConfig,
        paths: { agamaDir: temporaryRoot },
        log() {},
        setGet() {},
        setPost() {},
      };
      require("../routes/api/config")(api);

      assert.throws(
        () => api.saveLocalAppConf(disabledConfig),
        /requires fresh native authorization/
      );
      assert.strictEqual(await fs.pathExists(path.join(temporaryRoot, "config.json")), false);

      api.saveLocalAppConf(disabledConfig, {
        status: "approved",
        scope: "security-setting",
        actionId: "/config/save:disable-irreversible-authorization",
        operationId: "one-request-only",
      });
      assert.strictEqual(api.isIrreversibleAuthorizationEnabled(), false);
      assert.strictEqual(
        (await fs.readJson(path.join(temporaryRoot, "config.json"))).general.main
          .requireNativeAuthForIrreversibleActions,
        false
      );

      // Once the user has deliberately disabled the setting, ordinary saves
      // that preserve that choice do not cause another security prompt.
      api.saveLocalAppConf(disabledConfig);

      api.saveLocalAppConf(currentConfig);
      assert.strictEqual(api.isIrreversibleAuthorizationEnabled(), true);
      assert.throws(
        () => api.saveLocalAppConf(disabledConfig, {
          status: "approved",
          scope: "security-setting",
          actionId: "/config/save:disable-irreversible-authorization",
          operationId: "one-request-only",
        }),
        /requires fresh native authorization/
      );
      await fs.remove(temporaryRoot);
    });
  });

  describe("native API restrictions", function () {
    const {
      daemonConfigurationEnablesChainWriting,
      effectiveStartupEnablesChainWriting,
      hasStartupOption,
      isAllowedRpcMethod,
      isAllowedStartupOption,
      isSafeWalletImportPath,
      isSafeWalletFilename,
      isValidChainTicker,
      startupOptionsEnableChainWriting,
      validateLaunchConfig,
      validateStartupOptions,
    } = require("../routes/api/native/security");

    it("detects startup options that enable automatic chain writes", function () {
      for (const options of [
        ["-gen"],
        ["--GEN=1"],
        ["-gen=-1"],
        ["-gen=1trailing"],
        ["-gen= 1 trailing"],
        ["-nogen=0"],
        ["-nogen=false"],
        ["-mint"],
        ["-nomint=0"],
        ["-migration=1"],
        ["-nomigration=0"],
        ["-notary=1"],
        ["-nonotary=0"],
        ["-alwayssubmitnotarizations"],
        ["-noalwayssubmitnotarizations=0"],
        ["-allowdelayednotarizations=0"],
        ["-noallowdelayednotarizations"],
        ["-gen=0", "-mint=1"],
        ["-gen=0", "-gen=1"],
        ["-nogen", "-gen=1"],
      ]) {
        assert.strictEqual(startupOptionsEnableChainWriting(options), true, options.join(" "));
      }

      for (const options of [
        [],
        ["-gen=0"],
        ["-gen=false"],
        ["-gen=true"],
        ["-nogen"],
        ["-nogen=1"],
        ["-nonogen"],
        ["-nonogen=0"],
        ["-nononogen=0"],
        ["-mint=0"],
        ["-nomint"],
        ["-migration=0"],
        ["-nomigration"],
        ["-notary=0"],
        ["-noalwayssubmitnotarizations"],
        ["-allowdelayednotarizations"],
        ["-noallowdelayednotarizations=0"],
        ["-genproclimit=8"],
        ["-mineraddress=RExample"],
        ["-migrationdestaddress=zsExample"],
        ["-notaryid=Example@"],
        ["-gen=1", "-gen=0"],
        ["-gen=0", "-nogen=0"],
        ["-nogen=0", "-gen=0"],
      ]) {
        assert.strictEqual(startupOptionsEnableChainWriting(options), false, options.join(" "));
      }

      assert.strictEqual(startupOptionsEnableChainWriting(null), false);
      assert.strictEqual(startupOptionsEnableChainWriting("-gen"), false);
    });

    it("detects chain-writing settings in daemon config with command-line precedence", function () {
      assert.strictEqual(
        daemonConfigurationEnablesChainWriting("rpcuser=test\nmint=1\n"),
        true
      );
      assert.strictEqual(
        daemonConfigurationEnablesChainWriting("gen=0\nallowdelayednotarizations=1\n"),
        false
      );
      assert.strictEqual(
        daemonConfigurationEnablesChainWriting("includeconf=extra.conf\n"),
        true,
        "included configuration must fail closed"
      );
      assert.strictEqual(
        effectiveStartupEnablesChainWriting(["-mint=0"], "mint=1\n"),
        false,
        "an explicit command-line setting overrides the config file"
      );
      assert.strictEqual(
        effectiveStartupEnablesChainWriting([], "nogen=0\n"),
        true
      );
    });

    it("allows read-only RPCs and rejects key export or fund movement", function () {
      assert.strictEqual(isValidChainTicker("VRSC"), true);
      assert.strictEqual(isValidChainTicker("VRSC; touch /tmp/pwned"), false);
      assert.strictEqual(isAllowedRpcMethod("getinfo"), true);
      assert.strictEqual(isAllowedRpcMethod("dumpprivkey"), false);
      assert.strictEqual(isAllowedRpcMethod("z_exportwallet"), false);
      assert.strictEqual(isAllowedRpcMethod("sendcurrency"), false);
    });

    it("allows ordinary daemon flags and rejects unsafe capability overrides", function () {
      const reportedOptions = [
        "-arbitrageaddress=Oink@",
        "-notaryid=Oink@",
        "-fastload=0",
      ];
      const validated = validateStartupOptions(reportedOptions);

      assert.deepStrictEqual(validated, reportedOptions);
      assert.notStrictEqual(validated, reportedOptions);
      assert.strictEqual(isAllowedStartupOption("-mint"), true);
      assert.strictEqual(isAllowedStartupOption("-txindex=1"), true);
      assert.strictEqual(isAllowedStartupOption("-addressindex"), true);
      assert.strictEqual(isAllowedStartupOption("-addnode=127.0.0.1"), true);
      assert.strictEqual(isAllowedStartupOption("-rpcthreads=8"), true);
      assert.strictEqual(isAllowedStartupOption("-rpcworkqueue=32"), true);
      assert.strictEqual(isAllowedStartupOption("--notaryid=Oink@"), true);
      assert.strictEqual(
        isAllowedStartupOption("-notaryid=Verus Coin Foundation@"),
        true
      );

      assert.strictEqual(isAllowedStartupOption("-rpcbind=0.0.0.0"), false);
      assert.strictEqual(isAllowedStartupOption("--norpcbind=0"), false);
      assert.strictEqual(isAllowedStartupOption("-exportdir=/tmp"), true);
      assert.strictEqual(isAllowedStartupOption("-conf=/tmp/unsafe.conf"), false);
      assert.strictEqual(isAllowedStartupOption("-datadir=/tmp"), false);
      assert.strictEqual(isAllowedStartupOption("-notarydatadir=/tmp"), false);
      assert.strictEqual(isAllowedStartupOption("-rpcport=1234"), false);
      assert.strictEqual(isAllowedStartupOption("-rpcuser=unsafe"), false);
      assert.strictEqual(isAllowedStartupOption("-rpcpassword=unsafe"), false);
      assert.strictEqual(isAllowedStartupOption("-debug=net"), true);
      assert.strictEqual(isAllowedStartupOption("-debug=zrpcunsafe"), true);
      assert.strictEqual(isAllowedStartupOption("-debug=rpcapi"), true);
      assert.strictEqual(isAllowedStartupOption("-debug=1"), true);
      assert.strictEqual(isAllowedStartupOption("-debug"), true);
      assert.strictEqual(isAllowedStartupOption("-nodebug"), true);
      assert.strictEqual(isAllowedStartupOption("-nodebug=0"), true);
      assert.strictEqual(isAllowedStartupOption("-chain=vrsc"), false);
      assert.strictEqual(isAllowedStartupOption("-chain=vrsc", "VRSC"), true);
      assert.deepStrictEqual(
        validateStartupOptions(["-chain=vrsc"], "VRSC"),
        ["-chain=vrsc"]
      );
      assert.throws(
        () => validateStartupOptions(["-chain=other"], "VRSC"),
        /not allowed/
      );
      assert.strictEqual(isAllowedStartupOption("-ac_name=OTHER"), false);
      assert.strictEqual(
        isAllowedStartupOption("-ac_name=VRSC", "VRSC"),
        true
      );

      for (const option of [
        "-alertnotify",
        "-alertnotify=echo unsafe",
        "--NOALERTNOTIFY",
        "-blocknotify=echo unsafe",
        "--NOBLOCKNOTIFY",
        "-walletnotify=echo unsafe",
        "--WALLETNOTIFY=echo unsafe",
        "/walletnotify=echo unsafe",
        "/-walletnotify=echo unsafe",
        "/-noalertnotify=0",
        "/-noblocknotify=0",
        "/-nowalletnotify=0",
        "-noalertnotify=0",
        "-noblocknotify=0",
        "-nowalletnotify=0",
        "-nonowalletnotify=0",
      ]) {
        assert.strictEqual(isAllowedStartupOption(option), false, option);
      }
      assert.strictEqual(isAllowedStartupOption("-foowalletnotify=1"), true);
      assert.strictEqual(isAllowedStartupOption("-notify=1"), true);
      assert.strictEqual(
        isAllowedStartupOption("/notaryid=Oink@"),
        process.platform === "win32"
      );
      assert.strictEqual(isAllowedStartupOption("txindex=1"), false);
      assert.strictEqual(isAllowedStartupOption("-txindex=1\n-rpcbind=0.0.0.0"), false);
      assert.strictEqual(isAllowedStartupOption("-notaryid=Oink@\0-rpcbind=0.0.0.0"), false);
      assert.throws(
        () => validateStartupOptions("-notaryid=Oink@"),
        /must be an array/
      );
      assert.throws(() => validateStartupOptions([42]), /not allowed/);
      assert.deepStrictEqual(
        validateStartupOptions(Array(64).fill("-mint")),
        Array(64).fill("-mint")
      );
      assert.throws(
        () => validateStartupOptions(Array(257).fill("-mint")),
        /Too many/
      );
      assert.throws(
        () => validateStartupOptions([`-uacomment=${"x".repeat(13 * 1024)}`]),
        /too large/
      );

      assert.strictEqual(hasStartupOption(reportedOptions, "fastload"), true);
      assert.strictEqual(hasStartupOption(["--nofastload"], "fastload"), true);
      assert.strictEqual(
        hasStartupOption(["-nonofastload=0"], "fastload"),
        true
      );
      assert.strictEqual(hasStartupOption(["-notaryid=Oink@"], "fastload"), false);

      assert.throws(() => validateLaunchConfig("VRSC", {
        daemon: "verusd",
        dirNames: { darwin: "../../tmp", linux: ".komodo/VRSC", win32: "Komodo/VRSC" },
      }), /data directory/);
    });

    it("defers startup-option checks until native coin activation needs them", async function () {
      const api = {
        appConfig: {
          general: { native: { remindNativeBackup: false } },
          coin: { native: { stakeGuard: {} } },
        },
        chainParams: { VRSC: {} },
        coinsInitializing: {},
        customKomodoNetworks: {},
        native: { launchConfigs: {} },
        paths: {
          vrscDataDir: path.join(os.tmpdir(), "verus-security-test-vrsc"),
          mineDataDir: path.join(os.tmpdir(), "verus-security-test-mine"),
          runningDataDir: path.join(os.tmpdir(), "verus-security-test-running"),
        },
        loadLocalConfig() {},
        log() {},
        saveLocalAppConf() {},
        setPost() {},
      };
      require("../routes/api/native/coins")(api);

      const activations = [];
      api.native.activateNativeCoin = async (chainTicker, getOptions) => {
        activations.push({ chainTicker, getOptions });
      };
      const startupOptions = [
        "-arbitrageaddress=Oink@",
        "-notaryid=Oink@",
        "-fastload=0",
      ];

      const vrscLaunchConfig = {
        daemon: "verusd",
        dirNames: {
          darwin: "Komodo/VRSC",
          linux: ".komodo/VRSC",
          win32: "Komodo/VRSC",
        },
        startupOptions: [],
        tags: [],
      };

      // addCoin can attach without resolving options when startDaemon finds an
      // existing process. If it later needs to spawn, the deferred check fails.
      await api.native.addCoin(
        "VRSC",
        vrscLaunchConfig,
        ["-walletnotify=echo unsafe"]
      );
      assert.strictEqual(typeof activations[0].getOptions, "function");
      assert.throws(() => activations[0].getOptions(), /not allowed/);

      let startupAuthorizationChecks = 0;
      const assertStartupAuthorization = api.native.assertStartupAuthorization;
      api.native.assertStartupAuthorization = (...args) => {
        startupAuthorizationChecks += 1;
        return assertStartupAuthorization(...args);
      };
      api.assertProtectedActionExecutionActive = () => {
        throw new Error("The protected action request ended before execution completed");
      };
      assert.throws(
        () => activations[0].getOptions(),
        /request ended before execution completed/
      );
      assert.strictEqual(startupAuthorizationChecks, 0);
      delete api.assertProtectedActionExecutionActive;

      assert.throws(
        () => api.native.addCoin(
          "VRSC",
          {
            ...vrscLaunchConfig,
            dirNames: {
              ...vrscLaunchConfig.dirNames,
              linux: "../../tmp",
            },
          },
          ["-walletnotify=echo unsafe"]
        ),
        /data directory/
      );

      await api.native.addCoin("VRSC", vrscLaunchConfig, startupOptions);
      assert.strictEqual(activations[1].chainTicker, "VRSC");
      assert.deepStrictEqual(activations[1].getOptions(), startupOptions);

      await api.native.addCoin(
        "VRSC",
        {
          ...vrscLaunchConfig,
          startupOptions: ["-chain=vrsc"],
        },
        []
      );
      assert.deepStrictEqual(activations[2].getOptions(), ["-chain=vrsc"]);

      await api.native.addCoin("MINE", {
        confName: "abc123",
        daemon: "verusd",
        dirNames: {
          darwin: "Verus/pbaas/abc123",
          linux: ".verus/pbaas/abc123",
          win32: "Verus/pbaas/abc123",
        },
        startupOptions: ["-chain=mine"],
        tags: [],
      }, ["-chain=mine", "-txindex=1"]);
      assert.strictEqual(activations[3].chainTicker, "MINE");
      assert.deepStrictEqual(activations[3].getOptions(), [
        "-txindex=1",
        "-chain=mine",
      ]);

      await api.native.addCoin("RUNNING", {
        confName: "running123",
        daemon: "verusd",
        dirNames: {
          darwin: "Verus/pbaas/running123",
          linux: ".verus/pbaas/running123",
          win32: "Verus/pbaas/running123",
        },
        startupOptions: [],
        tags: [],
      }, ["-fastload=0"]);
      assert.strictEqual(activations[4].chainTicker, "RUNNING");
      assert.throws(
        () => activations[4].getOptions(),
        /Unsupported dynamic chain/
      );
    });

    it("does not validate or authorize unused options when activation only attaches", async function () {
      const api = {
        appConfig: {
          general: { native: { remindNativeBackup: false } },
          coin: {
            native: {
              dataDir: { VRSC: "" },
              stakeGuard: {},
            },
          },
        },
        assetChainPorts: { VRSC: "27486" },
        assetChainPortsDefault: { VRSC: 27486 },
        chainParams: { VRSC: {} },
        coinsInitializing: {},
        customKomodoNetworks: {},
        native: { launchConfigs: {} },
        paths: { vrscDataDir: path.join(os.tmpdir(), "verus-attach-only-vrsc") },
        loadLocalConfig() {},
        log() {},
        saveLocalAppConf() {},
        setPost() {},
      };
      require("../routes/api/native/coins")(api);
      const launchConfig = {
        daemon: "verusd",
        dirNames: {
          darwin: "Komodo/VRSC",
          linux: ".komodo/VRSC",
          win32: "Komodo/VRSC",
        },
        startupOptions: [],
        tags: [],
      };
      const unsafeUnusedOptions = ["-walletnotify=echo unsafe"];

      api.checkPort = async (port) => {
        assert.strictEqual(port, 27486);
        return "UNAVAILABLE";
      };
      const attachState = await api.native.captureActivationSecurityState(
        "VRSC",
        launchConfig,
        unsafeUnusedOptions
      );
      assert.strictEqual(attachState.attachOnly, true);
      assert.strictEqual(attachState.chainWriting, false);

      api.checkPort = async () => "AVAILABLE";
      await assert.rejects(
        api.native.captureActivationSecurityState(
          "VRSC",
          launchConfig,
          unsafeUnusedOptions
        ),
        /not allowed/
      );
    });

    it("normalizes strict decimal RPC ports and rejects ambiguous values", function () {
      const { normalizeRpcPort, readRpcPort } = require("../routes/api/utils/rpcPort");
      assert.strictEqual(normalizeRpcPort(27486), 27486);
      assert.strictEqual(normalizeRpcPort(" 27486 "), 27486);
      for (const invalid of [0, 65536, "", "27486#comment", "1e3", "0x10", 2.5]) {
        assert.strictEqual(normalizeRpcPort(invalid), null, String(invalid));
      }
      assert.deepStrictEqual(
        readRpcPort("# rpcport=9999\nrpcport = 12345 # local daemon\n"),
        { found: true, port: 12345 }
      );
      assert.deepStrictEqual(
        readRpcPort("rpcport=not-a-port\n"),
        { found: true, port: null }
      );
    });

    it("prefers and normalizes a custom daemon-config RPC port", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-rpc-port-test-"));
      const confFile = path.join(temporaryRoot, "VRSC.conf");
      await fs.writeFile(confFile, "rpcport=12345\nrpcuser=user\nrpcpassword=pass\n");
      const api = {
        appConfig: {
          general: { main: { reservedChains: ["VRSC"] } },
          coin: { native: { dataDir: { VRSC: "" }, noFastLoad: { VRSC: false } } },
        },
        assetChainPorts: { VRSC: 27486 },
        assetChainPortsDefault: { VRSC: 27486 },
        log() {},
        native: { startParams: {} },
        paths: { vrscDataDir: temporaryRoot },
        rpcConf: {},
      };
      require("../routes/api/daemonControl")(api);

      await api.prepareCoinPort("VRSC", null, null);
      assert.strictEqual(api.assetChainPorts.VRSC, 12345);
      assert.strictEqual(typeof api.assetChainPorts.VRSC, "number");
      assert.strictEqual(api.assetChainPortsDefault.VRSC, 27486);
      await fs.remove(temporaryRoot);
    });

    it("rejects dangerous restart options before stopping a daemon", async function () {
      const api = {
        appConfig: {
          general: { native: { remindNativeBackup: false } },
          coin: { native: { stakeGuard: {} } },
        },
        chainParams: { VRSC: {} },
        coinsInitializing: {},
        customKomodoNetworks: {},
        native: { launchConfigs: {} },
        loadLocalConfig() {},
        log() {},
        saveLocalAppConf() {},
        setPost() {},
      };
      require("../routes/api/native/coins")(api);
      require("../routes/api/native/restart")(api);

      let quitCalls = 0;
      api.quitDaemon = async () => {
        quitCalls += 1;
      };

      await assert.rejects(
        api.native.restartCoin(
          "VRSC",
          {
            daemon: "verusd",
            dirNames: {
              darwin: "Komodo/VRSC",
              linux: ".komodo/VRSC",
              win32: "Komodo/VRSC",
            },
            startupOptions: [],
            tags: [],
          },
          ["-blocknotify=echo unsafe"]
        ),
        /not allowed/
      );
      assert.strictEqual(quitCalls, 0);
    });

    it("settles and clears initialization state when restart polling fails", async function () {
      let restartRoute;
      const api = {
        appConfig: {
          general: { native: { remindNativeBackup: false } },
          coin: { native: { stakeGuard: {} } },
        },
        chainParams: { VRSC: {} },
        coinsInitializing: {},
        customKomodoNetworks: {},
        native: { launchConfigs: {} },
        restartPollIntervalMs: 1,
        restartPollTimeoutMs: 25,
        loadLocalConfig() {},
        log() {},
        saveLocalAppConf() {},
        setPost(route, handler) {
          if (route === "/native/coins/restart") restartRoute = handler;
        },
      };
      require("../routes/api/native/coins")(api);
      require("../routes/api/native/restart")(api);

      api.quitDaemon = async () => {};
      api.isDaemonRunning = async () => {
        throw new Error("daemon status unavailable");
      };

      const launchConfig = {
        daemon: "verusd",
        dirNames: {
          darwin: "Komodo/VRSC",
          linux: ".komodo/VRSC",
          win32: "Komodo/VRSC",
        },
        startupOptions: [],
        tags: [],
      };
      let response;
      await new Promise((resolve) => {
        restartRoute(
          {
            body: { chainTicker: "VRSC", launchConfig, startupOptions: [] },
            native_authorization: null,
          },
          {
            send(body) {
              response = JSON.parse(body);
              resolve();
            },
          }
        );
      });

      assert.deepStrictEqual(response, {
        msg: "error",
        result: "daemon status unavailable",
        restartState: {
          stage: "waiting-for-stop",
          daemonStopInitiated: true,
        },
      });
      assert.strictEqual(api.coinsInitializing.VRSC, undefined);
    });

    it("times out a hung restart status check without wedging initialization", async function () {
      const api = {
        appConfig: {
          general: { native: { remindNativeBackup: false } },
          coin: { native: { stakeGuard: {} } },
        },
        chainParams: { VRSC: {} },
        coinsInitializing: {},
        customKomodoNetworks: {},
        native: { launchConfigs: {} },
        restartPollIntervalMs: 1,
        restartPollTimeoutMs: 5,
        loadLocalConfig() {},
        log() {},
        saveLocalAppConf() {},
        setPost() {},
      };
      require("../routes/api/native/coins")(api);
      require("../routes/api/native/restart")(api);

      api.quitDaemon = async () => {};
      api.isDaemonRunning = async () => new Promise(() => {});

      await assert.rejects(
        api.native.restartCoin(
          "VRSC",
          {
            daemon: "verusd",
            dirNames: {
              darwin: "Komodo/VRSC",
              linux: ".komodo/VRSC",
              win32: "Komodo/VRSC",
            },
            startupOptions: [],
            tags: [],
          },
          []
        ),
        /Timed out while checking whether verusd stopped/
      );
      assert.strictEqual(api.coinsInitializing.VRSC, undefined);
    });

    it("validates startup options only when starting a daemon", async function () {
      const runWith = async (
        requestedOptions,
        portStatus = "AVAILABLE",
        customDataDir = ""
      ) => {
        const api = {
          appConfig: {
            general: { main: { reservedChains: ["VRSC"] } },
            coin: {
              native: {
                dataDir: { VRSC: customDataDir },
                noFastLoad: { VRSC: false },
              },
            },
          },
          assetChainPorts: { VRSC: 27486 },
          assetChainPortsDefault: {},
          confFileIndex: {},
          log() {},
          logFileIndex: {},
          native: { startParams: {} },
          paths: {
            agamaDir: "/unused",
            verusdBin: "/unused/verusd",
            vrscDataDir: "/unused/VRSC",
          },
          rpcConf: {},
          startedDaemonRegistry: {},
        };
        require("../routes/api/daemonControl")(api);
        api.initCoinDir = async () => true;
        api.initLogfile = async () => {};
        api.initConfFile = async () => {};
        api.prepareCoinPort = async () => {};
        api.checkPort = async () => portStatus;
        api.setCoinDir = () => {};

        let spawnedOptions;
        let optionReads = 0;
        api.spawnDaemonChild = (daemon, coin, options) => {
          assert.strictEqual(daemon, "verusd");
          assert.strictEqual(coin, "VRSC");
          spawnedOptions = options.slice();
        };

        let error;
        try {
          await api.startDaemon(
            "VRSC",
            () => {
              optionReads += 1;
              return Array.isArray(requestedOptions)
                ? requestedOptions.slice()
                : requestedOptions;
            },
            "verusd",
            {
              darwin: "Komodo/VRSC",
              linux: ".komodo/VRSC",
              win32: "Komodo/VRSC",
            },
            "VRSC"
          );
        } catch (e) {
          error = e;
        }

        return { error, optionReads, spawnedOptions };
      };

      assert.deepStrictEqual((await runWith([])).spawnedOptions, ["-fastload"]);
      assert.deepStrictEqual(
        (await runWith(["-fastload=0"])).spawnedOptions,
        ["-fastload=0"]
      );
      assert.deepStrictEqual(
        (await runWith(["-fastload=1"])).spawnedOptions,
        ["-fastload=1"]
      );
      assert.deepStrictEqual(
        (await runWith(["--nofastload"])).spawnedOptions,
        ["--nofastload"]
      );
      assert.deepStrictEqual(
        (await runWith([], "AVAILABLE", "/managed/VRSC")).spawnedOptions,
        ["-datadir=/managed/VRSC", "-fastload"]
      );

      const attached = await runWith(
        ["-walletnotify=echo unsafe"],
        "UNAVAILABLE"
      );
      assert.strictEqual(attached.error, undefined);
      assert.strictEqual(attached.optionReads, 0);
      assert.strictEqual(attached.spawnedOptions, undefined);

      const attachedWithMalformedOptions = await runWith(
        "not an array",
        "UNAVAILABLE"
      );
      assert.strictEqual(attachedWithMalformedOptions.error, undefined);
      assert.strictEqual(attachedWithMalformedOptions.optionReads, 0);

      const blockedSpawn = await runWith(["-walletnotify=echo unsafe"]);
      assert.match(blockedSpawn.error.message, /not allowed/);
      assert.strictEqual(blockedSpawn.optionReads, 1);
      assert.strictEqual(blockedSpawn.spawnedOptions, undefined);

      const malformedSpawn = await runWith("not an array");
      assert.match(malformedSpawn.error.message, /must be an array/);
      assert.strictEqual(malformedSpawn.optionReads, 1);
      assert.strictEqual(malformedSpawn.spawnedOptions, undefined);
    });

    it("requires wallet import/export filenames to be basenames", function () {
      assert.strictEqual(isSafeWalletFilename("wallet-export.txt"), true);
      assert.strictEqual(isSafeWalletFilename("../wallet-export.txt"), false);
      assert.strictEqual(isSafeWalletFilename("folder/wallet-export.txt"), false);
      assert.strictEqual(isSafeWalletFilename("C:\\wallet-export.txt"), false);
      assert.strictEqual(isSafeWalletImportPath("/tmp/wallet-export.txt"), true);
      assert.strictEqual(isSafeWalletImportPath("C:\\wallet-export.txt"), true);
      assert.strictEqual(isSafeWalletImportPath("wallet-export.txt"), false);
      assert.strictEqual(isSafeWalletImportPath("/tmp/wallet\nexport.txt"), false);
    });
  });

  describe("PIN file containment and throttling", function () {
    const {
      assertAttemptAllowed,
      recordFailedAttempt,
      resolvePinFile,
    } = require("../routes/api/utils/pinSecurity");

    it("rejects traversal and applies exponential backoff", function () {
      assert.throws(() => resolvePinFile("/tmp/pins", "../../seed"), /Invalid pin file name/);
      assert.strictEqual(resolvePinFile("/tmp/pins", "safe_key"), "/tmp/pins/safe_key.pin");
      assert.doesNotThrow(() => resolvePinFile("/tmp/pins", "a".repeat(251)));
      assert.throws(() => resolvePinFile("/tmp/pins", "a".repeat(252)), /Invalid pin file name/);

      const attempts = new Map();
      recordFailedAttempt(attempts, "safe_key", 1000);
      assert.throws(() => assertAttemptAllowed(attempts, "safe_key", 1500), /Too many failed/);
      assert.doesNotThrow(() => assertAttemptAllowed(attempts, "safe_key", 2000));
    });

    it("returns a throttling response instead of rejecting through the encrypted response shim", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-pin-test-"));
      let decryptHandler;
      const api = {
        paths: { agamaDir: temporaryRoot },
        sensitiveDataApproval: approvingSensitiveDataService(),
        getNetworkData() { return require("../routes/electrumjs/electrumjs.networks").btc; },
        log() {},
        setPost(route, handler) {
          if (route === "/decryptkey") decryptHandler = handler;
        },
      };
      require("../routes/api/pin")(api);

      const invoke = async () => {
        let response;
        await decryptHandler(
          { body: { pubkey: "missing_key", key: "incorrect" } },
          { send(value) { response = JSON.parse(value); } },
          () => {}
        );
        return response;
      };

      assert.strictEqual((await invoke()).result, "Pin file not found");
      assert.match((await invoke()).result, /Too many failed attempts/);
      await fs.remove(temporaryRoot);
    });

    it("decrypts current and legacy seeds without changing either PIN file", async function () {
      const aes256 = require("nodejs-aes256");
      const iocane = require("iocane");
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-pin-format-test-"));
      const pinDirectory = path.join(temporaryRoot, "shepherd", "pin");
      await fs.ensureDir(pinDirectory);
      let decryptHandler;
      const api = {
        paths: { agamaDir: temporaryRoot },
        sensitiveDataApproval: approvingSensitiveDataService(),
        getNetworkData() { return require("../routes/electrumjs/electrumjs.networks").btc; },
        log() {},
        setPost(route, handler) {
          if (route === "/decryptkey") decryptHandler = handler;
        },
      };
      require("../routes/api/pin")(api);
      const invoke = async (pubkey, key) => {
        let response;
        await decryptHandler(
          { body: { pubkey, key } },
          { send(value) { response = JSON.parse(value); } },
          () => {}
        );
        return response;
      };

      const seed = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
      const password = "correct horse battery staple 123!";
      const currentSession = iocane.createSession().use("cbc").setDerivationRounds(300000);
      const currentFile = path.join(pinDirectory, "current_key.pin");
      const currentPayload = await currentSession.encrypt(seed, password);
      await fs.writeFile(currentFile, currentPayload);
      const currentBefore = await fs.readFile(currentFile);
      assert.strictEqual((await invoke("current_key", password)).result, seed);
      assert.deepStrictEqual(await fs.readFile(currentFile), currentBefore);
      assert.strictEqual((await invoke("current_key", "wrong password")).result, "Incorrect password.");
      assert.deepStrictEqual(await fs.readFile(currentFile), currentBefore);

      const legacyFile = path.join(pinDirectory, "legacy_key.pin");
      await fs.writeFile(legacyFile, aes256.encrypt(password, seed));
      const legacyBefore = await fs.readFile(legacyFile);
      assert.strictEqual((await invoke("legacy_key", password)).result, seed);
      assert.deepStrictEqual(await fs.readFile(legacyFile), legacyBefore);
      await fs.remove(temporaryRoot);
    });

    it("recovers a PIN from its immutable backup without replacing the primary", async function () {
      const aes256 = require("nodejs-aes256");
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-pin-backup-test-"));
      const pinDirectory = path.join(temporaryRoot, "shepherd", "pin");
      await fs.ensureDir(pinDirectory);
      const pinFile = path.join(pinDirectory, "recoverable_key.pin");
      const backupFile = `${pinFile}.bak`;
      const primaryBytes = Buffer.from("$invalid-current-payload");
      const seed = "one two three four five six seven eight nine ten eleven twelve";
      const password = "another correct horse battery staple 456!";
      await fs.writeFile(pinFile, primaryBytes);
      await fs.writeFile(backupFile, aes256.encrypt(password, seed));
      let decryptHandler;
      const api = {
        paths: { agamaDir: temporaryRoot },
        sensitiveDataApproval: approvingSensitiveDataService(),
        getNetworkData() { return require("../routes/electrumjs/electrumjs.networks").btc; },
        log() {},
        setPost(route, handler) {
          if (route === "/decryptkey") decryptHandler = handler;
        },
      };
      require("../routes/api/pin")(api);
      let response;
      await decryptHandler(
        { body: { pubkey: "recoverable_key", key: password } },
        { send(value) { response = JSON.parse(value); } },
        () => {}
      );
      assert.strictEqual(response.result, seed);
      assert.deepStrictEqual(await fs.readFile(pinFile), primaryBytes);
      await fs.remove(temporaryRoot);
    });

    it("verifies new encrypted seeds and refuses to replace an existing PIN", async function () {
      const iocane = require("iocane");
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-pin-write-test-"));
      await fs.ensureDir(path.join(temporaryRoot, "shepherd", "pin"));
      let encryptHandler;
      const api = {
        paths: { agamaDir: temporaryRoot },
        alertMainWindow() {},
        getNetworkData() { return require("../routes/electrumjs/electrumjs.networks").btc; },
        log() {},
        setPost(route, handler) {
          if (route === "/encryptkey") encryptHandler = handler;
        },
      };
      require("../routes/api/pin")(api);
      const seed = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
      const firstPassword = "first strong encryption password 123!";
      const secondPassword = "second strong encryption password 456!";
      const invoke = async (key) => {
        let response;
        await encryptHandler(
          { body: { key, string: seed } },
          { send(value) { response = JSON.parse(value); } },
          () => {}
        );
        return response;
      };

      const firstResponse = await invoke(firstPassword);
      assert.strictEqual(firstResponse.msg, "success");
      const pinFile = path.join(temporaryRoot, "shepherd", "pin", `${firstResponse.result}.pin`);
      const firstBytes = await fs.readFile(pinFile);

      const secondResponse = await invoke(secondPassword);
      assert.strictEqual(secondResponse.msg, "error");
      assert.deepStrictEqual(await fs.readFile(pinFile), firstBytes);
      assert.strictEqual(await fs.pathExists(`${pinFile}.bak`), false);
      const session = iocane.createSession().use("cbc").setDerivationRounds(300000);
      assert.strictEqual(await session.decrypt(await fs.readFile(pinFile, "utf8"), firstPassword), seed);
      await fs.remove(temporaryRoot);
    });
  });

  describe("persistent data integrity", function () {
    it("atomically replaces files while preserving the first known-good backup", async function () {
      const { atomicWriteFileSync, validateJsonBuffer } = require("../routes/api/utils/atomicFile");
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-atomic-test-"));
      const target = path.join(temporaryRoot, "state.json");
      const first = Buffer.from(JSON.stringify({ generation: 1 }));
      const second = Buffer.from(JSON.stringify({ generation: 2 }));
      const third = Buffer.from(JSON.stringify({ generation: 3 }));
      await fs.writeFile(target, first);

      atomicWriteFileSync(target, second, { validate: validateJsonBuffer });
      assert.deepStrictEqual(await fs.readFile(target), second);
      assert.deepStrictEqual(await fs.readFile(`${target}.bak`), first);

      atomicWriteFileSync(target, third, { validate: validateJsonBuffer });
      assert.deepStrictEqual(await fs.readFile(target), third);
      assert.deepStrictEqual(await fs.readFile(`${target}.bak`), first);

      assert.throws(
        () => atomicWriteFileSync(target, "not-json", { validate: validateJsonBuffer }),
        /JSON/
      );
      assert.deepStrictEqual(await fs.readFile(target), third);
      assert.deepStrictEqual(await fs.readFile(`${target}.bak`), first);
      await fs.remove(temporaryRoot);
    });

    it("creates files without replacement on portable filesystems without hard links", async function () {
      const nodeFs = require("fs");
      const { atomicCreateFileSync } = require("../routes/api/utils/atomicFile");
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-portable-create-"));
      const target = path.join(temporaryRoot, "seed.pin");
      const seedBytes = Buffer.from("verified-encrypted-seed");
      const originalLinkSync = nodeFs.linkSync;

      try {
        nodeFs.linkSync = () => {
          const error = new Error("hard links are unsupported");
          error.code = "ENOTSUP";
          throw error;
        };
        atomicCreateFileSync(target, seedBytes);
      } finally {
        nodeFs.linkSync = originalLinkSync;
      }

      assert.deepStrictEqual(await fs.readFile(target), seedBytes);
      assert.throws(() => atomicCreateFileSync(target, "replacement"), /already exists/);
      assert.deepStrictEqual(await fs.readFile(target), seedBytes);
      await fs.remove(temporaryRoot);
    });

    it("leaves the live file intact when an atomic replacement cannot commit", async function () {
      const nodeFs = require("fs");
      const { atomicWriteFileSync, validateJsonBuffer } = require("../routes/api/utils/atomicFile");
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-interrupted-write-"));
      const target = path.join(temporaryRoot, "users.json");
      const originalBytes = Buffer.from('{"legacy":{"pinFile":"RLegacy"}}');
      await fs.writeFile(target, originalBytes);
      const originalRenameSync = nodeFs.renameSync;

      try {
        nodeFs.renameSync = (source, destination) => {
          if (destination === target) {
            const error = new Error("simulated storage failure");
            error.code = "EIO";
            throw error;
          }
          return originalRenameSync(source, destination);
        };
        assert.throws(
          () => atomicWriteFileSync(target, '{"replacement":true}', {
            validate: validateJsonBuffer,
          }),
          /simulated storage failure/
        );
      } finally {
        nodeFs.renameSync = originalRenameSync;
      }

      assert.deepStrictEqual(await fs.readFile(target), originalBytes);
      assert.deepStrictEqual(await fs.readFile(`${target}.bak`), originalBytes);
      await fs.remove(temporaryRoot);
    });

    it("leaves deprecated JSON data byte-for-byte unchanged during load", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-json-upgrade-test-"));
      const commitmentFile = path.join(temporaryRoot, "nameCommits.json");
      const deprecated = Buffer.from(JSON.stringify({ commitment: "recoverable-value" }));
      await fs.writeFile(commitmentFile, deprecated);
      const api = {
        paths: { agamaDir: temporaryRoot },
        log() {},
        setGet() {},
        setPost() {},
      };
      require("../routes/api/data_files/jsonFileManager")(api);
      assert.deepStrictEqual(await api.loadLocalCommitments(), { commitment: "recoverable-value" });
      assert.deepStrictEqual(await fs.readFile(commitmentFile), deprecated);
      await fs.remove(temporaryRoot);
    });

    it("loads users from a valid backup without touching a corrupt primary", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-users-recovery-test-"));
      const usersFile = path.join(temporaryRoot, "users.json");
      const corruptPrimary = Buffer.from("{corrupt");
      const knownUsers = { user1: { pinFile: "recoverable_key" } };
      await fs.writeFile(usersFile, corruptPrimary);
      await fs.writeJson(`${usersFile}.bak`, knownUsers);
      const api = {
        paths: { agamaDir: temporaryRoot },
        log() {},
        setGet() {},
        setPost() {},
      };
      require("../routes/api/users")(api);
      assert.deepStrictEqual(api.loadLocalUsers(), knownUsers);
      assert.deepStrictEqual(await fs.readFile(usersFile), corruptPrimary);
      await fs.remove(temporaryRoot);
    });

    it("loads config from a valid backup without replacing a corrupt primary", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-config-recovery-test-"));
      const configFile = path.join(temporaryRoot, "config.json");
      const corruptPrimary = Buffer.from("{corrupt");
      const backupConfig = JSON.parse(JSON.stringify(require("../routes/appConfig").config));
      backupConfig.general.main.livelog = true;
      await fs.writeFile(configFile, corruptPrimary);
      await fs.writeJson(`${configFile}.bak`, backupConfig);
      const api = {
        paths: { agamaDir: temporaryRoot },
        log() {},
        setGet() {},
        setPost() {},
      };
      require("../routes/api/config")(api);
      assert.strictEqual(api.loadLocalConfig().general.main.livelog, true);
      assert.deepStrictEqual(await fs.readFile(configFile), corruptPrimary);
      await fs.remove(temporaryRoot);
    });

    it("stages legacy app data before atomically committing its migration", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-layout-migration-test-"));
      const oldRoot = path.join(temporaryRoot, "Verus-Desktop");
      const newRoot = path.join(oldRoot, "appdata");
      const oldPin = path.join(oldRoot, "shepherd", "pin", "legacy.pin");
      const pinBytes = Buffer.from("encrypted-seed-bytes");
      await fs.ensureDir(path.dirname(oldPin));
      await fs.writeFile(oldPin, pinBytes);
      await fs.writeJson(path.join(oldRoot, "users.json"), { user1: { pinFile: "legacy" } });
      await fs.writeJson(path.join(oldRoot, "nameCommits.json"), { commitment: "value" });
      const api = {
        paths: {
          VerusDesktopDir: oldRoot,
          agamaDir: newRoot,
          backupDir: path.join(oldRoot, "backups"),
        },
        log() {},
      };
      require("../routes/api/init")(api);
      api.updateDataFolderFormatv071();

      assert.deepStrictEqual(await fs.readFile(oldPin), pinBytes);
      assert.deepStrictEqual(
        await fs.readFile(path.join(newRoot, "shepherd", "pin", "legacy.pin")),
        pinBytes
      );
      assert.deepStrictEqual(
        await fs.readJson(path.join(newRoot, "nameCommits.json")),
        { commitment: "value" }
      );
      await fs.remove(temporaryRoot);
    });

    it("reads legacy and current encrypted seeds without changing either file", async function () {
      const legacyPassword = "A very strong legacy test password 123!";
      const legacySeed = "alpha beta gamma delta epsilon zeta eta theta";
      const legacyCiphertext =
        "T/EzdWnMuDu9EF0w4q873S5QulzDIcxTPQTNvU9NhKid7iIrpM82XtpErwT7LgOnjaqchQFDEae2hLqsuQ==";
      const modernPassword = "This is a sufficiently strong password 123!";
      const modernSeed = "alpha beta gamma 123";
      const modernCiphertext =
        "PW5zinGK7PVkJQCNuWve164SR4daYckW7GV59aMrF4s=$5782b0596e8fdde16913692b827b45a9$ZQOHs41gdTEe$c29e9c1167d343b4e5780633488685ff33fda270193a6dde11803e3ecd1e0ec1$300000$cbc";
      const preV1IocaneCiphertext =
        "5YeY3xfU9IdPKnqwaDH3KQ==$019bd022090e9bef921c53a43fe0fa5a$02498e1cd4f2$f50d328c0682c05ec729f3ca888ef6b689fbeb471a6740f8619c89aedc4ebea0$245392";
      const {
        decryptPinPayload,
        encryptPinPayload,
        storeNewPinFile,
      } = require("../routes/api/utils/pinFile");

      assert.strictEqual(await decryptPinPayload(legacyCiphertext, legacyPassword), legacySeed);
      assert.strictEqual(await decryptPinPayload(modernCiphertext, modernPassword), modernSeed);
      assert.strictEqual(await decryptPinPayload(preV1IocaneCiphertext, "passw0rd"), "test content");
      await assert.rejects(
        () => decryptPinPayload(modernCiphertext, "incorrect password"),
        /HMAC|decrypt|authentication|Failed/i
      );

      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-legacy-pin-"));
      const pinDir = path.join(temporaryRoot, "shepherd", "pin");
      await fs.ensureDir(pinDir);
      const bitcoin = require("bitgo-utxo-lib");
      const deriveScalarFromSeed = require("../routes/api/utils/auth/scalar");
      const networks = require("../routes/electrumjs/electrumjs.networks");
      const { dBigi } = deriveScalarFromSeed(legacySeed, { iguana: true });
      const pinName = new bitcoin.ECPair(dBigi, null, { network: networks.btc }).getAddress();
      const pinFile = path.join(pinDir, `${pinName}.pin`);
      await fs.writeFile(pinFile, legacyCiphertext);
      const originalBytes = await fs.readFile(pinFile);

      let decryptHandler;
      let encryptHandler;
      const api = {
        alertMainWindow() {},
        getNetworkData() { return networks.btc; },
        log() {},
        paths: { agamaDir: temporaryRoot },
        sensitiveDataApproval: approvingSensitiveDataService(),
        setPost(route, handler) {
          if (route === "/decryptkey") decryptHandler = handler;
          if (route === "/encryptkey") encryptHandler = handler;
        },
      };
      require("../routes/api/pin")(api);
      const invoke = async (handler, body) => {
        let response;
        await handler(
          { body },
          { send(value) { response = JSON.parse(value); } },
          () => {}
        );
        return response;
      };

      const unlocked = await invoke(decryptHandler, { pubkey: pinName, key: legacyPassword });
      assert.strictEqual(unlocked.msg, "success");
      assert.strictEqual(unlocked.result, legacySeed);
      assert.deepStrictEqual(await fs.readFile(pinFile), originalBytes);

      const wrongPassword = await invoke(
        decryptHandler,
        { pubkey: pinName, key: "an incorrect legacy password" }
      );
      assert.strictEqual(wrongPassword.msg, "error");
      assert.deepStrictEqual(await fs.readFile(pinFile), originalBytes);

      const savedAgain = await invoke(encryptHandler, { key: legacyPassword, string: legacySeed });
      assert.strictEqual(savedAgain.msg, "success");
      assert.deepStrictEqual(await fs.readFile(pinFile), originalBytes);
      assert.strictEqual(await fs.pathExists(`${pinFile}.bak`), false);

      const differentCiphertext = await encryptPinPayload("a different seed value", legacyPassword);
      await assert.rejects(
        () => storeNewPinFile(pinFile, differentCiphertext, legacyPassword, "a different seed value"),
        /Refusing to overwrite/
      );
      assert.deepStrictEqual(await fs.readFile(pinFile), originalBytes);
      await fs.remove(temporaryRoot);
    });
  });

  describe("persistent data upgrade safety", function () {
    it("fails before touching live data when a required snapshot cannot be copied", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-snapshot-failure-"));
      const appData = path.join(temporaryRoot, "appdata");
      const backups = path.join(temporaryRoot, "backups");
      const pinDir = path.join(appData, "shepherd", "pin");
      await fs.ensureDir(pinDir);
      await fs.ensureDir(backups);
      const usersFile = path.join(appData, "users.json");
      const pinFile = path.join(pinDir, "RLegacy.pin");
      const usersBytes = Buffer.from('{"legacy":{"pinFile":"RLegacy"}}');
      const pinBytes = Buffer.from("legacy-encrypted-seed");
      await fs.writeFile(usersFile, usersBytes);
      await fs.writeFile(pinFile, pinBytes);
      const api = { log() {}, paths: { agamaDir: appData, backupDir: backups } };
      require("../routes/api/init")(api);
      const originalCopySync = fs.copySync;

      try {
        fs.copySync = () => {
          const error = new Error("simulated snapshot failure");
          error.code = "EIO";
          throw error;
        };
        assert.throws(
          () => api.createUpgradeSafetySnapshot(),
          /Unable to create required pre-upgrade safety snapshot/
        );
      } finally {
        fs.copySync = originalCopySync;
      }

      assert.deepStrictEqual(await fs.readFile(usersFile), usersBytes);
      assert.deepStrictEqual(await fs.readFile(pinFile), pinBytes);
      assert.strictEqual(
        await fs.pathExists(path.join(backups, "pre-security-hardening-v1")),
        false
      );
      await fs.remove(temporaryRoot);
    });

    it("keeps deprecated raw JSON intact and backs it up before an explicit save", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-legacy-json-"));
      const commitmentFile = path.join(temporaryRoot, "nameCommits.json");
      const legacyCommitments = { legacy: { commitment: "abc123", created: 12345 } };
      const originalBytes = Buffer.from(JSON.stringify(legacyCommitments));
      await fs.writeFile(commitmentFile, originalBytes);
      const api = {
        paths: { agamaDir: temporaryRoot },
        log() {},
        post() {},
        rpcCalls: { GET: {}, POST: {} },
        setGet() {},
        setPost() {},
      };
      require("../routes/api/data_files/jsonFileManager")(api);

      assert.deepStrictEqual(await api.loadLocalCommitments(), legacyCommitments);
      assert.deepStrictEqual(await fs.readFile(commitmentFile), originalBytes);

      const updated = { ...legacyCommitments, next: { commitment: "def456" } };
      await api.saveLocalCommitments(updated);
      assert.deepStrictEqual((await fs.readJson(commitmentFile)).data, updated);
      assert.deepStrictEqual(await fs.readFile(`${commitmentFile}.bak`), originalBytes);
      await fs.remove(temporaryRoot);
    });

    it("atomically saves user-to-PIN mappings and fails over without rewriting corruption", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-users-data-"));
      const usersFile = path.join(temporaryRoot, "users.json");
      const originalUsers = { user1: { name: "Legacy", pinFile: "RLegacyPin" } };
      const originalBytes = Buffer.from(JSON.stringify(originalUsers));
      await fs.writeFile(usersFile, originalBytes);
      const api = {
        paths: { agamaDir: temporaryRoot },
        log() {},
        setGet() {},
        setPost() {},
      };
      require("../routes/api/users")(api);

      const updatedUsers = {
        ...originalUsers,
        user2: { name: "Second", pinFile: "RSecondPin" },
      };
      api.saveLocalUsers(updatedUsers);
      assert.deepStrictEqual(await fs.readJson(usersFile), updatedUsers);
      assert.deepStrictEqual(await fs.readFile(`${usersFile}.bak`), originalBytes);

      const malformed = Buffer.from('{"user1":');
      await fs.writeFile(usersFile, malformed);
      assert.deepStrictEqual(api.loadLocalUsers(), originalUsers);
      assert.deepStrictEqual(await fs.readFile(usersFile), malformed);
      await fs.remove(temporaryRoot);
    });

    it("creates and verifies an immutable pre-upgrade snapshot of fund-access data", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-upgrade-snapshot-"));
      const appData = path.join(temporaryRoot, "appdata");
      const backups = path.join(temporaryRoot, "backups");
      const pinDir = path.join(appData, "shepherd", "pin");
      await fs.ensureDir(pinDir);
      await fs.ensureDir(backups);
      const configBytes = Buffer.from('{"general":{"native":{"dataDir":"/legacy/wallets"}}}');
      const usersBytes = Buffer.from('{"user":{"pinFile":"RPin"}}');
      const usersBackupBytes = Buffer.from('{"older":{"pinFile":"ROlderPin"}}');
      const commitmentsBytes = Buffer.from('{"commitment":"recoverable"}');
      const pinBytes = Buffer.from("legacy-encrypted-seed-bytes");
      const pinBackupBytes = Buffer.from("older-encrypted-seed-bytes");
      await fs.writeFile(path.join(appData, "config.json"), configBytes);
      await fs.writeFile(path.join(appData, "config.json.bak"), configBytes);
      await fs.writeFile(path.join(appData, "users.json"), usersBytes);
      await fs.writeFile(path.join(appData, "users.json.bak"), usersBackupBytes);
      await fs.writeFile(path.join(appData, "users_backup_123.json"), usersBackupBytes);
      await fs.writeFile(path.join(appData, "nameCommits.json"), commitmentsBytes);
      await fs.writeFile(path.join(appData, "nameCommits.json.bak"), commitmentsBytes);
      await fs.writeFile(path.join(pinDir, "RPin.pin"), pinBytes);
      await fs.writeFile(path.join(pinDir, "RPin.pin.bak"), pinBackupBytes);
      const api = {
        log() {},
        paths: { agamaDir: appData, backupDir: backups },
      };
      require("../routes/api/init")(api);

      const snapshot = api.createUpgradeSafetySnapshot();
      assert.deepStrictEqual(await fs.readFile(path.join(snapshot, "config.json")), configBytes);
      assert.deepStrictEqual(await fs.readFile(path.join(snapshot, "users.json")), usersBytes);
      assert.deepStrictEqual(
        await fs.readFile(path.join(snapshot, "shepherd", "pin", "RPin.pin")),
        pinBytes
      );
      const marker = await fs.readJson(path.join(snapshot, ".complete"));
      assert.deepStrictEqual(Object.keys(marker.files).sort(), [
        "config.json",
        "config.json.bak",
        "nameCommits.json",
        "nameCommits.json.bak",
        path.join("shepherd", "pin", "RPin.pin"),
        path.join("shepherd", "pin", "RPin.pin.bak"),
        "users.json",
        "users.json.bak",
        "users_backup_123.json",
      ].sort());

      await fs.writeFile(path.join(appData, "users.json"), '{"changed":true}');
      assert.strictEqual(api.createUpgradeSafetySnapshot(), snapshot);
      assert.deepStrictEqual(await fs.readFile(path.join(snapshot, "users.json")), usersBytes);

      await fs.writeFile(path.join(snapshot, "shepherd", "pin", "RPin.pin"), "corrupt");
      const recoverySnapshot = api.createUpgradeSafetySnapshot();
      assert.notStrictEqual(recoverySnapshot, snapshot);
      assert.deepStrictEqual(
        await fs.readFile(path.join(recoverySnapshot, "shepherd", "pin", "RPin.pin")),
        pinBytes
      );
      await fs.remove(temporaryRoot);
    });

    it("stages legacy app-data migration while leaving every source file intact", async function () {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-folder-migration-"));
      const legacyRoot = path.join(temporaryRoot, "Verus-Desktop");
      const newAppData = path.join(legacyRoot, "appdata");
      const legacyPinDir = path.join(legacyRoot, "shepherd", "pin");
      await fs.ensureDir(legacyPinDir);
      const usersBytes = Buffer.from('{"legacy":{"pinFile":"RLegacy"}}');
      const pinBytes = Buffer.from("old-pin-ciphertext");
      await fs.writeFile(path.join(legacyRoot, "users.json"), usersBytes);
      await fs.writeFile(path.join(legacyPinDir, "RLegacy.pin"), pinBytes);
      const api = {
        log() {},
        paths: { VerusDesktopDir: legacyRoot, agamaDir: newAppData },
      };
      require("../routes/api/init")(api);

      api.updateDataFolderFormatv071();
      assert.deepStrictEqual(await fs.readFile(path.join(legacyRoot, "users.json")), usersBytes);
      assert.deepStrictEqual(await fs.readFile(path.join(legacyPinDir, "RLegacy.pin")), pinBytes);
      assert.deepStrictEqual(await fs.readFile(path.join(newAppData, "users.json")), usersBytes);
      assert.deepStrictEqual(
        await fs.readFile(path.join(newAppData, "shepherd", "pin", "RLegacy.pin")),
        pinBytes
      );
      await fs.remove(temporaryRoot);
    });
  });

  describe("Electrum security", function () {
    const Electrum = require("../routes/electrumjs/electrumjs.core");
    const { electrumServers } = require("../routes/electrumjs/electrumServers");
    const {
      validateElectrumServerList,
    } = require("../routes/api/electrum/serverValidation");

    it("uses TLS for all official Verus defaults", function () {
      assert(electrumServers.vrsc.serverList.length > 0);
      assert(electrumServers.vrsc.serverList.every((server) => server.endsWith(":ssl")));
    });

    it("rejects malformed and non-opted-in TCP server lists", function () {
      assert.throws(
        () => validateElectrumServerList(["attacker.example:50001:tcp"]),
        /not allowed/
      );
      assert.throws(
        () => validateElectrumServerList(["bad/server:50002:ssl"]),
        /Invalid Electrum/
      );
      assert.deepStrictEqual(
        validateElectrumServerList(["secure.example:50002:ssl"]),
        ["secure.example:50002:ssl"]
      );
    });

    it("caps unterminated response buffers", function () {
      const parser = new Electrum.MessageParser(() => {}, 16);
      assert.throws(() => parser.run("x".repeat(17)), /maximum message buffer/);
    });

    it("closes on malformed JSON and unexpected subscription events", function () {
      const client = new Electrum(50002, "secure.example", "ssl");
      client.status = 2;
      assert.doesNotThrow(() => client.onMessage("not-json"));
      assert.strictEqual(client.status, 0);

      client.status = 2;
      assert.doesNotThrow(() => client.onMessage('{"method":"error","params":[]}'));
      assert.strictEqual(client.status, 0);
    });

    it("ignores only known empty ElectrumX capability notifications", function () {
      const client = new Electrum(50002, "secure.example", "ssl");
      client.status = 2;

      client.onMessage('{"jsonrpc":"2.0","method":"blockchain.relayfee"}');
      client.onMessage('{"jsonrpc":"2.0","method":"blockchain.estimatefee"}');
      assert.strictEqual(client.status, 2);

      client.conn = { destroy() {} };
      client.onMessage('{"jsonrpc":"2.0","method":"blockchain.relayfee","params":[]}');
      assert.strictEqual(client.status, 0);
    });

    it("rejects response types that do not match the requested method", async function () {
      const client = new Electrum(50002, "secure.example", "ssl");
      client.status = 2;
      client.conn = { write() {}, destroy() {} };
      const response = client.request("blockchain.address.get_balance", ["address"]);
      const originalLog = console.log;
      console.log = () => {};
      try {
        client.onMessage('{"id":1,"result":[]}');
        await assert.rejects(response, /close connect/);
      } finally {
        console.log = originalLog;
      }
      assert.strictEqual(client.status, 0);
    });

    it("times out individual requests without timing out idle pooled sockets", async function () {
      const client = new Electrum(50002, "secure.example", "ssl", 5);
      client.status = 2;
      client.conn = { write() {}, destroy() {} };

      const originalLog = console.log;
      console.log = () => {};
      try {
        await assert.rejects(client.serverPing(), /request timed out/);
      } finally {
        console.log = originalLog;
      }
      assert.strictEqual(client.status, 0);
      assert.strictEqual(Object.keys(client.callbackMessageQueue).length, 0);
      assert.strictEqual(Electrum.isValidResultForMethod("server.ping", null), true);
      assert.strictEqual(Electrum.isValidResultForMethod("server.ping", {}), false);
    });
  });

  describe("plugin signature verification", function () {
    const { verifyHash } = require("../routes/api/utils/verifySignature");
    const hash = "a".repeat(64);

    it("fails closed unless the local verifier explicitly returns true", async function () {
      await assert.rejects(() => verifyHash(hash, "Signer@", "signature"), /No local/);
      assert.strictEqual(await verifyHash(hash, "Signer@", "signature", async () => true), true);
      assert.strictEqual(await verifyHash(hash, "Signer@", "signature", async () => ({})), false);
    });
  });

  describe("sensitive file permissions", function () {
    it("writes the builtin secret with owner-only permissions", async function () {
      if (process.platform === "win32") this.skip();
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-security-test-"));
      const api = {
        paths: { agamaDir: temporaryRoot },
        log() {},
        post() {},
        rpcCalls: { GET: {}, POST: {} },
        setGet() {},
        setPost() {},
      };
      require("../routes/api/data_files/jsonFileManager")(api);
      await api.saveBuiltinSecret({ BuiltinSecret: "secret" });
      const mode = (await fs.stat(path.join(temporaryRoot, "builtinsecret.json"))).mode & 0o777;
      assert.strictEqual(mode, 0o600);
      await fs.remove(temporaryRoot);
    });

    it("writes validated Electrum server lists with owner-only permissions", async function () {
      if (process.platform === "win32") this.skip();
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verus-electrum-test-"));
      const api = {
        appConfig: { general: { electrum: { syncServerListFromKv: false } } },
        electrumServers: {},
        log() {},
        paths: { agamaDir: temporaryRoot },
      };
      require("../routes/api/electrum/servers")(api);
      await api.saveElectrumServersList({
        vrsc: { txfee: 10000, serverList: ["el0.veruscoin.io:17486:ssl"] },
      });
      const serverFile = path.join(temporaryRoot, "electrumServers.json");
      const mode = (await fs.stat(serverFile)).mode & 0o777;
      assert.strictEqual(mode, 0o600);
      assert.throws(
        () => require("../routes/api/electrum/serverValidation").validateElectrumServersObject({
          vrsc: { serverList: ["bad/server:17486:ssl"] },
        }),
        /Invalid Electrum/
      );
      await fs.remove(temporaryRoot);
    });
  });
});
