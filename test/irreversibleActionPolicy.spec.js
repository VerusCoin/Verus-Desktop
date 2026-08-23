"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  AUTHORIZATION_SCOPES,
} = require("../routes/api/native/nativeAuthorization");
const {
  ALWAYS_AUTHORIZED_ROUTES,
  IRREVERSIBLE_ACTION_ROUTES,
  IRREVERSIBLE_AUTH_SETTING,
  createApiAuthorizationRequest,
} = require("../routes/api/native/irreversibleActionPolicy");

const MAIN_CONTEXT = Object.freeze({
  callerBuiltin: true,
  callerAppId: "VERUS_DESKTOP_MAIN",
  irreversibleAuthorizationEnabled: true,
  currentConfig: {
    general: {
      main: {
        [IRREVERSIBLE_AUTH_SETTING]: true,
      },
    },
  },
});

const EXPECTED_IRREVERSIBLE_ROUTES = Object.freeze([
  "/native/sendtx",
  "/native/sendcurrency",
  "/electrum/sendtx",
  "/eth/sendtx",
  "/erc20/sendtx",
  "/native/shieldcoinbase",
  "/native/register_id_name",
  "/native/register_id",
  "/native/update_id",
  "/native/recover_id",
  "/native/revoke_id",
  "/native/setidentitytimelock",
  "/native/makeoffer",
  "/native/takeoffer",
  "/native/closeoffers",
  "/native/start_mining",
  "/native/start_staking",
  "/native/start_bridgekeeper",
  "/native/bridgekeeper_setconf",
  "/native/sign_message",
  "/native/sign_file",
  "/native/verusid/login/sign_response",
  "/native/verusid/provision/sign_id_provisioning_request",
]);

const EXPECTED_ALWAYS_AUTHORIZED_ROUTES = Object.freeze([
  "/native/exportwallet",
  "/native/importwallet",
]);

describe("irreversible API authorization policy", function () {
  it("keeps the explicit protected-route inventory complete and exact", function () {
    assert.deepStrictEqual(
      [...IRREVERSIBLE_ACTION_ROUTES].sort(),
      [...EXPECTED_IRREVERSIBLE_ROUTES].sort()
    );
    assert.deepStrictEqual(
      [...ALWAYS_AUTHORIZED_ROUTES].sort(),
      [...EXPECTED_ALWAYS_AUTHORIZED_ROUTES].sort()
    );

    for (const route of EXPECTED_IRREVERSIBLE_ROUTES) {
      const request = createApiAuthorizationRequest(route, {}, MAIN_CONTEXT);
      assert.ok(request, `${route} must produce an authorization request`);
      assert.strictEqual(request.scope, AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION);
      assert.strictEqual(request.actionId, route);
      assert.match(request.detail, new RegExp(`API route: ${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }

    for (const route of EXPECTED_ALWAYS_AUTHORIZED_ROUTES) {
      const request = createApiAuthorizationRequest(route, {}, {
        ...MAIN_CONTEXT,
        irreversibleAuthorizationEnabled: false,
      });
      assert.ok(request, `${route} must remain authorized when the setting is off`);
      assert.strictEqual(request.scope, AUTHORIZATION_SCOPES.WALLET_AUTHORITY);
      assert.strictEqual(request.actionId, route);
    }
  });

  it("conditionally protects daemon activation and restart using final combined startup options", function () {
    for (const route of ["/native/coins/activate", "/native/coins/restart"]) {
      assert.strictEqual(
        createApiAuthorizationRequest(route, { startupOptions: ["-listen=1"] }, MAIN_CONTEXT),
        null,
        `${route} without chain-writing options`
      );
      assert.strictEqual(
        createApiAuthorizationRequest(
          route,
          { startupOptions: ["-gen=1", "-gen=0"] },
          MAIN_CONTEXT
        ),
        null,
        `${route} must honor the final duplicate value`
      );

      const directOptions = createApiAuthorizationRequest(
        route,
        { startupOptions: ["-gen=0", "-gen=1"] },
        MAIN_CONTEXT
      );
      assert.ok(directOptions, `${route} must protect an enabled final value`);
      assert.strictEqual(directOptions.scope, AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION);

      const launchConfigOptions = createApiAuthorizationRequest(
        route,
        {
          startupOptions: ["-gen=1", "-gen=0"],
          launchConfig: { startupOptions: ["-mint=0", "-mint=1"] },
        },
        MAIN_CONTEXT
      );
      assert.ok(launchConfigOptions, `${route} must inspect both option locations`);
      assert.match(launchConfigOptions.detail, /mint/);

      const positivePrecedence = createApiAuthorizationRequest(
        route,
        { startupOptions: ["-nogen=1", "-gen=1"] },
        MAIN_CONTEXT
      );
      assert.ok(positivePrecedence, `${route} must mirror positive-option precedence`);
    }
  });

  it("requires an always-on confirmation only when the setting changes from enabled to disabled", function () {
    const savePayload = (value) => ({
      configObj: {
        general: {
          main: {
            [IRREVERSIBLE_AUTH_SETTING]: value,
          },
        },
      },
    });

    const disableRequest = createApiAuthorizationRequest(
      "/config/save",
      savePayload(false),
      MAIN_CONTEXT
    );
    assert.ok(disableRequest);
    assert.strictEqual(disableRequest.scope, AUTHORIZATION_SCOPES.SECURITY_SETTING);
    assert.strictEqual(
      disableRequest.actionId,
      "/config/save:disable-irreversible-authorization"
    );

    assert.strictEqual(
      createApiAuthorizationRequest("/config/save", savePayload(true), MAIN_CONTEXT),
      null,
      "leaving the setting enabled"
    );
    assert.strictEqual(
      createApiAuthorizationRequest("/config/save", savePayload(false), {
        ...MAIN_CONTEXT,
        irreversibleAuthorizationEnabled: false,
      }),
      null,
      "re-saving an already-disabled setting"
    );
    assert.strictEqual(
      createApiAuthorizationRequest("/config/save", savePayload(true), {
        ...MAIN_CONTEXT,
        irreversibleAuthorizationEnabled: false,
      }),
      null,
      "re-enabling the setting"
    );
    assert.strictEqual(
      createApiAuthorizationRequest("/config/save", { configObj: {} }, MAIN_CONTEXT),
      null,
      "saving unrelated settings"
    );
  });

  it("excludes preflight, lookalikes, and unrelated routes", function () {
    const excludedRoutes = [
      "/electrum/tx_preflight",
      "/native/sendtx/preview",
      "/native/get_info",
    ];

    for (const route of excludedRoutes) {
      assert.strictEqual(
        createApiAuthorizationRequest(route, {}, MAIN_CONTEXT),
        null,
        `${route} must not be classified by this policy`
      );
    }
  });

  it("restricts protected prompts to the main built-in caller while preserving disabled-setting behavior", function () {
    const pluginContext = {
      callerBuiltin: true,
      callerAppId: "VERUS_LOGIN_CONSENT_UI",
      irreversibleAuthorizationEnabled: true,
    };

    assert.throws(
      () => createApiAuthorizationRequest("/native/sendtx", {}, pluginContext),
      /restricted to the main application/
    );
    assert.throws(
      () => createApiAuthorizationRequest("/native/sendtx", {}, {
        ...pluginContext,
        callerBuiltin: false,
        callerAppId: "VERUS_DESKTOP_MAIN",
      }),
      /restricted to the main application/
    );
    assert.throws(
      () => createApiAuthorizationRequest("/native/exportwallet", {}, {
        ...pluginContext,
        irreversibleAuthorizationEnabled: false,
      }),
      /restricted to the main application/
    );
    assert.throws(
      () => createApiAuthorizationRequest("/config/save", {
        configObj: { general: { main: { [IRREVERSIBLE_AUTH_SETTING]: false } } },
      }, pluginContext),
      /only be changed by the main application/
    );

    const disabledRequest = createApiAuthorizationRequest("/native/sendtx", {}, {
      ...pluginContext,
      irreversibleAuthorizationEnabled: false,
    });
    assert.ok(disabledRequest);
    assert.strictEqual(disabledRequest.scope, AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION);
  });

  it("allows only main or login-consent callers for consent/provisioning signatures", function () {
    for (const route of [
      "/native/verusid/login/sign_response",
      "/native/verusid/provision/sign_id_provisioning_request",
    ]) {
      const loginContext = {
        ...MAIN_CONTEXT,
        callerAppId: "VERUS_LOGIN_CONSENT_UI",
        ...(route === "/native/verusid/login/sign_response"
          ? { loginConsentSessionAvailable: true }
          : {}),
      };
      const request = createApiAuthorizationRequest(route, {}, loginContext);
      assert.strictEqual(request.callerAppId, "VERUS_LOGIN_CONSENT_UI");
      assert.throws(
        () => createApiAuthorizationRequest(route, {}, {
          ...loginContext,
          callerAppId: "VERUS_PBAAS_VISUALIZER",
        }),
        /restricted to the main application/
      );
      assert.throws(
        () => createApiAuthorizationRequest(route, {}, {
          ...loginContext,
          callerBuiltin: false,
        }),
        /restricted to the main application/
      );
    }

    assert.throws(
      () => createApiAuthorizationRequest(
        "/native/verusid/login/sign_response",
        {},
        {
          ...MAIN_CONTEXT,
          callerAppId: "VERUS_LOGIN_CONSENT_UI",
          loginConsentSessionAvailable: false,
        }
      ),
      /matching focused login-consent request/
    );
  });

  it("summarizes realistic nested login-consent responses and fingerprints the complete payload", function () {
    const response = {
      chainTicker: "VRSC",
      system_id: "iVerusSystem",
      signing_id: "login-consent-server@",
      signature: { signature: "EXISTING_SIGNATURE_MUST_NOT_APPEAR" },
      decision: {
        decision_id: "iDecision",
        created_at: 1664392484,
        subject: "Alice@",
        remember: true,
        remember_for: 7200,
        salt: "DECISION_SALT_MUST_NOT_APPEAR",
        request: {
          system_id: "iVerusSystem",
          signing_id: "login-consent-server@",
          challenge: {
            challenge_id: "iChallenge",
            requested_scope: [
              "vrsc::system.identity.authentication.scope.read-id-name",
            ],
            requested_access_token_audience: "https://service.example",
            redirect_uris: [{
              uri: "https://service.example/callback?state=exact",
              vdxfkey: "iRedirectType",
            }],
            client: {
              client_id: "auth-code-client",
              name: "Online Service",
              redirect_uris: [{
                uri: "https://service.example/callback?state=exact",
                vdxfkey: "iRedirectType",
              }],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code", "id_token"],
              scope: "vrsc::system.identity.authentication.scope.read-id-name",
              policy_uri: "https://service.example/privacy",
            },
          },
        },
      },
    };
    const context = {
      ...MAIN_CONTEXT,
      callerAppId: "VERUS_LOGIN_CONSENT_UI",
      loginConsentSessionAvailable: true,
    };
    const route = "/native/verusid/login/sign_response";
    const request = createApiAuthorizationRequest(route, { response }, context);
    const fingerprint = request.detail.match(
      /"canonicalPayloadFingerprint": \{[\s\S]*?"sha256": "([0-9a-f]{64})"/
    );

    assert.ok(fingerprint, "the complete canonical payload fingerprint must be displayed");
    assert.match(request.detail, /Online Service/);
    assert.match(request.detail, /Alice@/);
    assert.match(request.detail, /read-id-name/);
    assert.match(request.detail, /https:\/\/service\.example\/callback\?state=exact/);
    assert.doesNotMatch(request.detail, /EXISTING_SIGNATURE_MUST_NOT_APPEAR/);
    assert.doesNotMatch(request.detail, /DECISION_SALT_MUST_NOT_APPEAR/);

    const reverseKeys = (value) => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value == null || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])
      );
    };
    const reordered = createApiAuthorizationRequest(
      route,
      reverseKeys({ response }),
      context
    );
    assert.match(reordered.detail, new RegExp(fingerprint[1]));

    const changedPayload = JSON.parse(JSON.stringify({ response }));
    changedPayload.response.decision.request.challenge.redirect_uris[0].uri =
      "https://service.example/callback?state=changed";
    const changed = createApiAuthorizationRequest(route, changedPayload, context);
    assert.doesNotMatch(changed.detail, new RegExp(fingerprint[1]));
  });

  it("summarizes provisioning authority and fingerprints a realistic nested request", function () {
    const payload = {
      chainTicker: "VRSC",
      raddress: "RYQbUr9WtRRAnMjuddZGryrNEpFEV1h8ph",
      request: {
        signing_address: "RYQbUr9WtRRAnMjuddZGryrNEpFEV1h8ph",
        signature: { signature: "PROVISIONING_SIGNATURE_MUST_NOT_APPEAR" },
        challenge: {
          challenge_id: "iKNufKJdLX3Xg8qFru9AuLBvivAEJ88PW4",
          created_at: 1664382484,
          salt: "PROVISIONING_SALT_MUST_NOT_APPEAR",
          name: "New Identity",
          system_id: "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV",
          parent: "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV",
          context: {
            kv: {
              "i4KyLCxWZXeSkw15dF95CUKytEK3HU7em9": {
                service: { requestedPlan: "standard" },
              },
            },
          },
        },
      },
    };
    const route = "/native/verusid/provision/sign_id_provisioning_request";
    const request = createApiAuthorizationRequest(route, payload, {
      ...MAIN_CONTEXT,
      callerAppId: "VERUS_LOGIN_CONSENT_UI",
    });
    const fingerprint = request.detail.match(
      /"canonicalPayloadFingerprint": \{[\s\S]*?"sha256": "([0-9a-f]{64})"/
    );

    assert.ok(fingerprint);
    assert.match(request.detail, /RYQbUr9WtRRAnMjuddZGryrNEpFEV1h8ph/);
    assert.match(request.detail, /New Identity/);
    assert.match(request.detail, /requestedPlan/);
    assert.doesNotMatch(request.detail, /PROVISIONING_SIGNATURE_MUST_NOT_APPEAR/);
    assert.doesNotMatch(request.detail, /PROVISIONING_SALT_MUST_NOT_APPEAR/);

    const changedPayload = JSON.parse(JSON.stringify(payload));
    changedPayload.request.challenge.context.kv[
      "i4KyLCxWZXeSkw15dF95CUKytEK3HU7em9"
    ].service.requestedPlan = "enterprise";
    const changed = createApiAuthorizationRequest(route, changedPayload, {
      ...MAIN_CONTEXT,
      callerAppId: "VERUS_LOGIN_CONSENT_UI",
    });
    assert.doesNotMatch(changed.detail, new RegExp(fingerprint[1]));
  });

  it("displays every sendcurrency output beyond the former count limit and fails on prompt size", function () {
    const outputs = Array.from({ length: 31 }, (_, index) => ({
      address: `RRecipient${index}`,
      amount: index + 1,
    }));
    const request = createApiAuthorizationRequest(
      "/native/sendcurrency",
      { chainTicker: "VRSC", from: "RSource", outputs, feeamount: 0.0001 },
      MAIN_CONTEXT
    );

    assert.match(request.detail, /"outputCount": 31/);
    assert.match(request.detail, /RRecipient0/);
    assert.match(request.detail, /RRecipient30/);
    assert.doesNotMatch(request.detail, /TRUNCATED/);

    const tooLargeForPrompt = Array.from({ length: 400 }, (_, index) => ({
      address: `R${String(index).padStart(32, "0")}`,
      amount: 1,
    }));
    assert.throws(
      () => createApiAuthorizationRequest(
        "/native/sendcurrency",
        { chainTicker: "VRSC", from: "RSource", outputs: tooLargeForPrompt },
        MAIN_CONTEXT
      ),
      /cannot be displayed completely/
    );
  });

  it("redacts secrets and opaque chain content from the native prompt", function () {
    const secrets = {
      privateKey: "PRIVATE_KEY_MUST_NOT_APPEAR",
      seed: "SEED_MUST_NOT_APPEAR",
      password: "PASSWORD_MUST_NOT_APPEAR",
      customWif: "CUSTOM_WIF_MUST_NOT_APPEAR",
      memo: "MEMO_CONTENT_MUST_NOT_APPEAR",
      content: "CONTENT_MAP_MUST_NOT_APPEAR",
      ignored: "UNSELECTED_FIELD_MUST_NOT_APPEAR",
    };
    const request = createApiAuthorizationRequest(
      "/native/sendcurrency",
      {
        chainTicker: "VRSC",
        from: "RSource",
        outputs: [
          {
            privateKey: secrets.privateKey,
            seed: secrets.seed,
            password: secrets.password,
            customWif: secrets.customWif,
            memo: secrets.memo,
            contentmap: { message: secrets.content },
          },
        ],
        ignoredPrivateMaterial: secrets.ignored,
      },
      MAIN_CONTEXT
    );

    for (const secret of Object.values(secrets)) {
      assert.doesNotMatch(request.detail, new RegExp(secret));
    }
    assert.match(request.detail, /\[REDACTED: secret value\]/);
    assert.match(request.detail, /Content hidden from the prompt/);
    assert.match(request.detail, /"sha256": "[0-9a-f]{64}"/);
    assert.match(request.detail, /"chainTicker": "VRSC"/);
    assert.match(request.detail, /Requesting component: VERUS_DESKTOP_MAIN/);
  });

  it("shows custom Electrum outpoints while redacting the executable WIF", function () {
    const customWif = "L1SecretCustomWifMustNeverAppearInThePrompt";
    const request = createApiAuthorizationRequest(
      "/electrum/sendtx",
      {
        chainTicker: "VRSC",
        toAddress: "RDestination",
        amount: 1.25,
        verify: true,
        noSigature: false,
        customUtxos: [
          {
            txid: "0123456789abcdef".repeat(4),
            vout: 7,
            value: 125000000,
          },
        ],
        customWif,
      },
      MAIN_CONTEXT
    );

    assert.match(request.detail, /0123456789abcdef0123456789abcdef/);
    assert.match(request.detail, /"vout": 7/);
    assert.match(request.detail, /"verify": true/);
    assert.match(request.detail, /"noSigature": false/);
    assert.match(request.detail, /"customWif": "\[REDACTED: secret value\]"/);
    assert.doesNotMatch(request.detail, new RegExp(customWif));
  });

  it("fails closed on every prompt-display truncation limit while authorization is required", function () {
    let deepValue = "leaf";
    for (let index = 0; index < 8; index += 1) deepValue = { nested: deepValue };
    const denseValue = Array.from({ length: 30 }, (_, row) =>
      Object.fromEntries(
        Array.from({ length: 40 }, (_, column) => [`field_${row}_${column}`, column])
      )
    );
    const cases = [
      { chain: "VRSC", offer: Array.from({ length: 31 }, () => 1) },
      { chain: "VRSC", fromaddress: "R".repeat(513), offer: {} },
      { chain: "VRSC", offer: { ["k".repeat(257)]: 1 } },
      {
        chain: "VRSC",
        offer: Object.fromEntries(
          Array.from({ length: 51 }, (_, index) => [`field_${index}`, index])
        ),
      },
      { chain: "VRSC", offer: deepValue },
      { chain: "VRSC", offer: denseValue },
      {
        chain: "VRSC",
        offer: Array.from({ length: 30 }, (_, index) => ({
          address: `R${index}${"x".repeat(450)}`,
        })),
      },
    ];

    for (const payload of cases) {
      assert.throws(
        () => createApiAuthorizationRequest("/native/makeoffer", payload, MAIN_CONTEXT),
        /cannot be displayed completely/
      );
    }
  });

  it("enforces the policy in setPost before dispatching the decoded route handler", async function () {
    let registeredHandler;
    let settingEnabled = true;
    let authorizationOutcome = { status: "cancelled" };
    const authorizationRequests = [];
    const api = {
      appConfig: {
        general: {
          main: {
            livelog: false,
            [IRREVERSIBLE_AUTH_SETTING]: true,
          },
        },
      },
      BuiltinSecret: "test-builtin-secret",
      get() {},
      post(route, handler) { registeredHandler = handler; },
      rpcCalls: { GET: {}, POST: {} },
      log() {},
      isIrreversibleAuthorizationEnabled: () => settingEnabled,
      nativeAuthorization: {
        async authorize(request) {
          authorizationRequests.push(request);
          return authorizationOutcome;
        },
      },
      confFileIndex: { VRSC: "/tmp/VRSC.conf" },
      rpcConf: {
        VRSC: { port: 27486, user: "rpc-user", pass: "rpc-pass" },
      },
    };
    require("../routes/api/auth")(api);
    api.checkToken = () => true;

    const invoke = async (payload) => {
      let responseValue;
      const response = {
        headersSent: false,
        type() {},
        status() { return this; },
        send(value) {
          this.headersSent = true;
          responseValue = JSON.parse(value);
          return this;
        },
      };
      await registeredHandler(
        {
          body: {
            app_id: "VERUS_DESKTOP_MAIN",
            builtin: true,
            encrypted: false,
            payload,
            time: Date.now(),
            validity_key: "unused-by-test",
          },
        },
        response,
        () => {}
      );
      return JSON.parse(responseValue.payload);
    };

    let executions = 0;
    api.setPost("/native/sendtx", (req, res) => {
      executions += 1;
      return res.send(JSON.stringify({ msg: "success", result: req.body.amount }));
    });

    assert.deepStrictEqual(await invoke({ chainTicker: "VRSC", amount: 1 }), {
      msg: "error",
      result: "Protected operation cancelled.",
    });
    assert.strictEqual(executions, 0);
    assert.strictEqual(authorizationRequests[0].actionId, "/native/sendtx");

    authorizationOutcome = { status: "approved", operationId: "approved-send" };
    assert.deepStrictEqual(await invoke({ chainTicker: "VRSC", amount: 2 }), {
      msg: "success",
      result: 2,
    });
    assert.strictEqual(executions, 1);

    settingEnabled = false;
    authorizationOutcome = { status: "not-required" };
    assert.deepStrictEqual(await invoke({ chainTicker: "VRSC", amount: 3 }), {
      msg: "success",
      result: 3,
    });
    assert.strictEqual(executions, 2);

    const outputs = Array.from({ length: 31 }, (_, index) => ({
      address: `RRecipient${index}`,
      amount: index + 1,
    }));
    let sendCurrencyExecutions = 0;
    api.setPost("/native/sendcurrency", (req, res) => {
      sendCurrencyExecutions += 1;
      return res.send(JSON.stringify({
        msg: "success",
        result: req.body.outputs.length,
      }));
    });

    settingEnabled = true;
    authorizationOutcome = { status: "approved", operationId: "must-not-be-used" };
    const promptCountBeforeBatchRequest = authorizationRequests.length;
    const batchOutcome = await invoke({
      chainTicker: "VRSC",
      from: "RSource",
      outputs,
    });
    assert.deepStrictEqual(batchOutcome, { msg: "success", result: 31 });
    assert.strictEqual(sendCurrencyExecutions, 1);
    assert.strictEqual(
      authorizationRequests.length,
      promptCountBeforeBatchRequest + 1,
      "a fully displayed multi-output action must reach authorization"
    );
    assert.match(authorizationRequests[authorizationRequests.length - 1].detail, /RRecipient30/);
    assert.doesNotMatch(
      authorizationRequests[authorizationRequests.length - 1].detail,
      /TRUNCATED/
    );

    settingEnabled = false;
    authorizationOutcome = { status: "not-required" };
    assert.deepStrictEqual(await invoke({
      chainTicker: "VRSC",
      from: "RSource",
      outputs,
    }), {
      msg: "success",
      result: 31,
    });
    assert.strictEqual(sendCurrencyExecutions, 2);
    assert.match(authorizationRequests[authorizationRequests.length - 1].detail, /RRecipient30/);

    let exportExecutions = 0;
    authorizationOutcome = { status: "cancelled" };
    api.setPost("/native/exportwallet", (req, res) => {
      exportExecutions += 1;
      return res.send(JSON.stringify({ msg: "success" }));
    });
    assert.deepStrictEqual(await invoke({ chain: "VRSC", filename: "wallet.txt" }), {
      msg: "error",
      result: "Protected operation cancelled.",
    });
    assert.strictEqual(exportExecutions, 0);
    assert.strictEqual(
      authorizationRequests[authorizationRequests.length - 1].scope,
      AUTHORIZATION_SCOPES.WALLET_AUTHORITY
    );
  });
});
