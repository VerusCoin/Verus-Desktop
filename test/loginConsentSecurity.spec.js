const assert = require("assert");
const { describe, it } = require("node:test");
const {
  LOGIN_CONSENT_ID_PROVISIONING_WEBHOOK_VDXF_KEY,
  LOGIN_CONSENT_REDIRECT_VDXF_KEY,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
  LoginConsentProvisioningRequest,
  LoginConsentRequest,
  ProvisioningInfo,
} = require("verus-typescript-primitives");
const {
  CALLBACK_MAX_BYTES,
  CALLBACK_TIMEOUT_MS,
  bindRedirectToRequest,
  createWebhookRequestConfig,
  getWebhookWithDeadline,
  isPublicIpAddress,
  parseBrowserRedirectUrl,
  parsePublicHttpsUrl,
  postWebhookWithDeadline,
  resolvePublicHttpsUrl,
  snapshotRequestRedirects,
} = require("../routes/api/utils/loginConsentSecurity");

const WEBHOOK_KEY = LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid;
const BROWSER_REDIRECT_KEY = LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid;
const LOGIN_CHALLENGE_ID = "iKNufKJdLX3Xg8qFru9AuLBvivAEJ88PW4";
const SYSTEM_ID = "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV";
const SIGNING_ID = "iB5PRXMHLYcNtM8dfLB6KwfJrHU2mKDYuU";
const SIGNING_ADDRESS = "RYQbUr9WtRRAnMjuddZGryrNEpFEV1h8ph";
const TEST_SIGNATURE =
  "AYG2IQABQSAN1fp6A9NIVbxvKuOVLLU+0I+G3oQGbRtS6u4Eampfb217Cdf5FCMScQhV9kMxtjI9GWzpchmjuiTB2tctk6qT";

const provisioningLoginRequest = () => new LoginConsentRequest({
  system_id: SYSTEM_ID,
  signing_id: SIGNING_ID,
  signature: { signature: TEST_SIGNATURE },
  challenge: {
    challenge_id: LOGIN_CHALLENGE_ID,
    requested_access: [],
    provisioning_info: [
      new ProvisioningInfo(
        "https://callback.example.com/provision",
        LOGIN_CONSENT_ID_PROVISIONING_WEBHOOK_VDXF_KEY.vdxfid
      ),
    ],
    created_at: 1664382484,
  },
});

const unsignedProvisioningRequest = (challengeId = LOGIN_CHALLENGE_ID) =>
  new LoginConsentProvisioningRequest({
    signing_address: SIGNING_ADDRESS,
    challenge: {
      challenge_id: challengeId,
      created_at: 1664382484,
      name: "alice",
      system_id: SYSTEM_ID,
      parent: SYSTEM_ID,
    },
  });

const publicLookup = async (hostname, options) => {
  assert.strictEqual(hostname, "callback.example.com");
  assert.deepStrictEqual(options, { all: true, verbatim: true });
  return [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ];
};

describe("login consent callback security", function () {
  describe("callback URL policy", function () {
    it("accepts public HTTPS URLs without credentials", async function () {
      const resolved = await resolvePublicHttpsUrl(
        "https://callback.example.com/consent?state=expected#fragment",
        publicLookup
      );

      assert.strictEqual(resolved.url.protocol, "https:");
      assert.strictEqual(resolved.url.hostname, "callback.example.com");
      assert.strictEqual(resolved.url.searchParams.get("state"), "expected");
      assert.deepStrictEqual(resolved.addresses, [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ]);

      assert.doesNotThrow(() => parsePublicHttpsUrl("https://8.8.8.8/callback"));
      assert.doesNotThrow(() => parsePublicHttpsUrl("https://[2606:4700:4700::1111]/callback"));
    });

    it("rejects insecure schemes, credentials, and local hostnames", function () {
      assert.throws(
        () => parsePublicHttpsUrl("http://callback.example.com/consent"),
        /must use HTTPS/
      );
      assert.throws(
        () => parsePublicHttpsUrl("https://user:secret@callback.example.com/consent"),
        /must not contain credentials/
      );

      for (const uri of [
        "https://localhost/consent",
        "https://wallet.local/consent",
        "https://service.internal/consent",
        "https://intranet/consent",
      ]) {
        assert.throws(() => parsePublicHttpsUrl(uri), /public hostname/, uri);
      }
    });

    it("rejects private, loopback, link-local, and obfuscated IP literals", function () {
      for (const uri of [
        "https://10.0.0.1/consent",
        "https://100.64.0.1/consent",
        "https://127.0.0.1/consent",
        "https://127.1/consent",
        "https://2130706433/consent",
        "https://169.254.169.254/latest/meta-data",
        "https://172.16.1.1/consent",
        "https://192.168.1.1/consent",
        "https://[::1]/consent",
        "https://[fc00::1]/consent",
        "https://[fe80::1]/consent",
        "https://[::ffff:127.0.0.1]/consent",
      ]) {
        assert.throws(() => parsePublicHttpsUrl(uri), /private or special-use/, uri);
      }

      assert.strictEqual(isPublicIpAddress("93.184.216.34"), true);
      assert.strictEqual(isPublicIpAddress("169.254.169.254"), false);
      assert.strictEqual(isPublicIpAddress("2606:4700:4700::1111"), true);
      assert.strictEqual(isPublicIpAddress("fd00:ec2::254"), false);
    });

    it("rejects a hostname if any DNS answer is private or special-use", async function () {
      await assert.rejects(
        resolvePublicHttpsUrl(
          "https://callback.example.com/consent",
          async () => [
            { address: "93.184.216.34", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]
        ),
        /exclusively to public addresses/
      );

      await assert.rejects(
        resolvePublicHttpsUrl(
          "https://callback.example.com/consent",
          async () => []
        ),
        /exclusively to public addresses/
      );

      await assert.rejects(
        resolvePublicHttpsUrl(
          "https://callback.example.com/consent",
          async () => [{ address: "93.184.216.34", family: 6 }]
        ),
        /exclusively to public addresses/
      );
    });

    it("bounds DNS resolution time", async function () {
      await assert.rejects(
        resolvePublicHttpsUrl(
          "https://callback.example.com/consent",
          async () => new Promise(() => {}),
          10
        ),
        /could not be resolved securely/
      );
    });

    it("preserves safe browser redirects without treating them as server-side requests", function () {
      assert.strictEqual(
        parseBrowserRedirectUrl("https://callback.example.com/consent").toString(),
        "https://callback.example.com/consent"
      );
      assert.strictEqual(
        parseBrowserRedirectUrl("http://127.0.0.1:5555/callback").toString(),
        "http://127.0.0.1:5555/callback"
      );
      assert.strictEqual(
        parseBrowserRedirectUrl("http://[::1]:5555/callback").toString(),
        "http://[::1]:5555/callback"
      );
      assert.strictEqual(
        parseBrowserRedirectUrl("http://[::ffff:127.0.0.1]:5555/callback").hostname,
        "[::ffff:7f00:1]"
      );

      assert.throws(
        () => parseBrowserRedirectUrl("http://callback.example.com/consent"),
        /must use HTTPS/
      );
      assert.throws(
        () => parseBrowserRedirectUrl("http://192.168.1.10/consent"),
        /must use HTTPS/
      );
      assert.throws(
        () => parseBrowserRedirectUrl("https://user:secret@callback.example.com/consent"),
        /must not contain credentials/
      );
      assert.throws(
        () => parseBrowserRedirectUrl("file:///tmp/callback"),
        /must use HTTPS/
      );
    });

    it("rejects an unsafe browser redirect before opening it", async function () {
      let opened = false;
      const api = { setPost() {} };
      require("../routes/api/plugin/builtin/loginconsentui")(api, {
        httpClient: { async post() {} },
        shell: { async openExternal() { opened = true; } },
      });

      await assert.rejects(
        api.loginConsentUi.handle_redirect(
          {},
          {
            uri: "http://callback.example.com/consent",
            vdxfkey: BROWSER_REDIRECT_KEY,
          }
        ),
        /must use HTTPS/
      );
      assert.strictEqual(opened, false);
    });

    it("rejects inherited object names as unsupported redirect types", async function () {
      const api = { setPost() {} };
      require("../routes/api/plugin/builtin/loginconsentui")(api, {
        httpClient: { async post() { throw new Error("must not post"); } },
        shell: { async openExternal() { throw new Error("must not open"); } },
      });

      await assert.rejects(
        api.loginConsentUi.handle_redirect(
          {},
          { uri: "https://callback.example.com", vdxfkey: "toString" }
        ),
        /Unsupported login consent redirect type/
      );
    });
  });

  describe("webhook transport", function () {
    it("pins validated DNS answers, disables redirects and bounds I/O", async function () {
      const { url, config } = await createWebhookRequestConfig(
        "https://callback.example.com/consent",
        { lookup: publicLookup }
      );

      assert.strictEqual(url, "https://callback.example.com/consent");
      assert.strictEqual(config.timeout, CALLBACK_TIMEOUT_MS);
      assert.strictEqual(config.maxRedirects, 0);
      assert.strictEqual(config.maxBodyLength, CALLBACK_MAX_BYTES);
      assert.strictEqual(config.maxContentLength, CALLBACK_MAX_BYTES);
      assert.strictEqual(config.proxy, false);
      assert.strictEqual(config.responseType, "text");

      const pinnedLookup = config.httpsAgent.options.lookup;
      const allAddresses = await new Promise((resolve, reject) => {
        pinnedLookup("callback.example.com", { all: true }, (error, addresses) => {
          if (error) reject(error);
          else resolve(addresses);
        });
      });
      assert.deepStrictEqual(allAddresses, [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ]);

      await assert.rejects(
        new Promise((resolve, reject) => {
          pinnedLookup("redirected.example.com", {}, (error, address) => {
            if (error) reject(error);
            else resolve(address);
          });
        }),
        /unexpected DNS lookup/
      );
    });

    it("enforces a wall-clock deadline in addition to the socket timeout", async function () {
      const slowClient = {
        post(url, body, config) {
          return new Promise((resolve, reject) => {
            config.signal.addEventListener(
              "abort",
              () => reject(new Error("request aborted")),
              { once: true }
            );
          });
        },
      };

      await assert.rejects(
        postWebhookWithDeadline(
          slowClient,
          "https://callback.example.com/consent",
          { approved: true },
          {},
          10
        ),
        /request aborted/
      );
    });

    it("keeps the deadline on declared Node runtimes without AbortController", async function () {
      const originalAbortController = global.AbortController;
      let rejectRequest;
      const legacyClient = {
        CancelToken: {
          source() {
            return {
              token: { type: "legacy-cancel-token" },
              cancel(message) {
                rejectRequest(new Error(message));
              },
            };
          },
        },
        post(url, body, config) {
          assert.deepStrictEqual(config.cancelToken, { type: "legacy-cancel-token" });
          return new Promise((resolve, reject) => {
            rejectRequest = reject;
          });
        },
      };

      try {
        global.AbortController = undefined;
        await assert.rejects(
          postWebhookWithDeadline(
            legacyClient,
            "https://callback.example.com/consent",
            { approved: true },
            {},
            10
          ),
          /deadline exceeded/
        );
      } finally {
        global.AbortController = originalAbortController;
      }
    });

    it("enforces the same wall-clock deadline for provisioning status reads", async function () {
      const slowClient = {
        get(url, config) {
          return new Promise((resolve, reject) => {
            config.signal.addEventListener(
              "abort",
              () => reject(new Error("request aborted")),
              { once: true }
            );
          });
        },
      };

      await assert.rejects(
        getWebhookWithDeadline(
          slowClient,
          "https://callback.example.com/status",
          {},
          10
        ),
        /request aborted/
      );
    });

    it("binds provisioning transport to a focused consent window and registered wallet signature", async function () {
      const handlers = new Map();
      const requests = [];
      let pushedMessage;
      let focused = true;
      let visible = true;
      let clock = 10_000;
      const window = {
        id: 912,
        isDestroyed: () => false,
        isVisible: () => visible,
        isFocused: () => focused,
        once() {},
        webContents: {
          isDestroyed: () => false,
          send(channel, message) {
            assert.strictEqual(channel, "ipc");
            pushedMessage = message;
          },
        },
      };
      const api = {
        native: {
          verusid: { login: {}, provision: {} },
          async sign_data() {
            return { signature: TEST_SIGNATURE };
          },
          async verify_hash() {
            return true;
          },
        },
        log() {},
        setPost(route, handler, forceEncryption) {
          handlers.set(route, { handler, forceEncryption });
        },
        startPlugin(id, builtin, onComplete, onFinishLoad) {
          assert.strictEqual(id, "VERUS_LOGIN_CONSENT_UI");
          assert.strictEqual(builtin, true);
          onFinishLoad(window);
        },
      };
      require("../routes/api/plugin/builtin/loginconsentui")(api, {
        now: () => clock,
        lookup: publicLookup,
        httpClient: {
          async post(url, body, config) {
            requests.push({ method: "POST", url, body, config });
            // Losing focus while an HTTPS request is in flight must not turn a
            // completed remote submission into an ambiguous local failure.
            focused = false;
            return {
              data: JSON.stringify({
                decision: {
                  result: {
                    state: "pending",
                    info_uri: "https://callback.example.com/status",
                  },
                },
              }),
            };
          },
          async get(url, config) {
            requests.push({ method: "GET", url, config });
            // Likewise, minimizing after a bound status request begins is not
            // grounds for discarding its response.
            visible = false;
            return { data: { decision: { result: { state: "complete" } } } };
          },
        },
        shell: { async openExternal() {} },
      });
      require("../routes/api/native/verusid/login/verifyRequest")(api);
      require("../routes/api/native/verusid/provision/signIdProvisioningRequest")(api);

      const invoke = async (route, body, appId = "VERUS_LOGIN_CONSENT_UI") => {
        let sent;
        await handlers.get(route).handler(
          {
            body,
            api_header: { app_id: appId, builtin: true },
          },
          { send(value) { sent = JSON.parse(value); } }
        );
        return sent;
      };

      const submitRoute = "/native/verusid/provision/submit_id_provisioning_request";
      const statusRoute = "/native/verusid/provision/get_id_provisioning_status";
      assert.strictEqual(handlers.get(submitRoute).forceEncryption, true);
      assert.strictEqual(handlers.get(statusRoute).forceEncryption, true);

      api.loginConsentUi.request(
        provisioningLoginRequest(),
        { id: "VERUS_DESKTOP_MAIN", search_builtin: true }
      );
      const capability = pushedMessage.data.provisioning_capability;
      assert.match(capability, /^[0-9a-f]{64}$/);

      const signRoute = "/native/verusid/provision/sign_id_provisioning_request";
      const verifyRoute = "/native/verusid/login/verify_request";
      const unsignedRequest = unsignedProvisioningRequest().toJson();
      assert.deepStrictEqual(
        await invoke(signRoute, {
          chainTicker: "VRSC",
          request: unsignedRequest,
          raddress: SIGNING_ADDRESS,
          capability,
        }),
        {
          msg: "error",
          result: "The original login consent request has not been verified",
        }
      );

      const requestToVerify = provisioningLoginRequest().toJson();
      requestToVerify.chainTicker = "VRSC";
      const differentRequest = {
        ...requestToVerify,
        challenge: {
          ...requestToVerify.challenge,
          challenge_id: "iRQZGW36o3RcVR1xyVT1qWdAKdxp3wUyrh",
        },
      };
      assert.deepStrictEqual(
        await invoke(verifyRoute, {
          request: differentRequest,
          capability,
        }),
        {
          msg: "error",
          result: "Login consent request does not belong to this provisioning session",
        }
      );
      assert.deepStrictEqual(
        await invoke(verifyRoute, { request: requestToVerify, capability }),
        { msg: "success", result: { verified: true } }
      );

      const signedResult = await invoke(signRoute, {
        chainTicker: "VRSC",
        request: unsignedRequest,
        raddress: SIGNING_ADDRESS,
        capability,
      });
      assert.strictEqual(signedResult.msg, "success");
      assert.ok(signedResult.result.signature);

      // The primitive serializer ignores unknown JSON keys. Bind and submit
      // the exact wallet-produced object so those keys cannot be smuggled to
      // the provisioning service under an otherwise valid signature.
      assert.deepStrictEqual(
        await invoke(submitRoute, {
          capability,
          request: {
            ...signedResult.result,
            attackerControlledMetadata: "must not leave the wallet",
          },
        }),
        {
          msg: "error",
          result: "Provisioning request was not signed for this consent session or was already submitted",
        }
      );
      assert.strictEqual(requests.length, 0);

      assert.deepStrictEqual(
        await invoke(submitRoute, {
          // Even a caller-supplied URI is ignored: the original signed login
          // request is the sole source of the POST destination.
          uri: "https://attacker.example/collect",
          capability,
          request: signedResult.result,
        }),
        {
          msg: "success",
          result: {
            decision: {
              result: {
                state: "pending",
                info_uri: "https://callback.example.com/status",
              },
            },
          },
        }
      );
      assert.strictEqual(requests[0].url, "https://callback.example.com/provision");

      // Polling is intentionally allowed while the still-visible consent
      // window is in the background; requiring focus would make the normal
      // ten-minute polling interval fail whenever the user switches windows.
      assert.strictEqual(focused, false);
      assert.deepStrictEqual(
        await invoke(statusRoute, {
          capability,
          uri: "https://callback.example.com/status",
        }),
        {
          msg: "success",
          result: { decision: { result: { state: "complete" } } },
        }
      );
      assert.deepStrictEqual(requests.map(({ method }) => method), ["POST", "GET"]);
      assert.ok(requests.every(({ config }) => config.maxRedirects === 0));
      assert.ok(requests.every(({ config }) => config.proxy === false));

      // A minimized/background consent window remains the live owner of its
      // unguessable capability. Status reads are already restricted to a URI
      // learned from the service and must not permanently fail on minimize.
      assert.strictEqual(visible, false);
      clock += 1_001;
      assert.deepStrictEqual(
        await invoke(statusRoute, {
          capability,
          uri: "https://callback.example.com/status",
        }),
        {
          msg: "success",
          result: { decision: { result: { state: "complete" } } },
        }
      );
      assert.deepStrictEqual(requests.map(({ method }) => method), ["POST", "GET", "GET"]);

      visible = true;
      focused = true;
      assert.deepStrictEqual(
        await invoke(submitRoute, {
          capability,
          request: signedResult.result,
        }),
        {
          msg: "error",
          result: "Provisioning request was not signed for this consent session or was already submitted",
        }
      );
      assert.deepStrictEqual(
        await invoke(statusRoute, {
          capability,
          uri: "https://attacker.example/status",
        }),
        {
          msg: "error",
          result: "Provisioning status URI was not issued for this consent session",
        }
      );

      const arbitrarySigned = {
        ...signedResult.result,
        challenge: { ...signedResult.result.challenge, name: "mallory" },
      };
      assert.deepStrictEqual(
        await invoke(submitRoute, {
          capability,
          request: arbitrarySigned,
        }),
        {
          msg: "error",
          result: "Provisioning request was not signed for this consent session or was already submitted",
        }
      );
      assert.strictEqual(requests.length, 3);

      focused = false;
      assert.deepStrictEqual(
        await invoke(signRoute, {
          chainTicker: "VRSC",
          request: unsignedProvisioningRequest().toJson(),
          raddress: SIGNING_ADDRESS,
          capability,
        }),
        {
          msg: "error",
          result: "The corresponding Login Consent window must be visible and focused",
        }
      );
      focused = true;

      assert.deepStrictEqual(
        await invoke(submitRoute, {
          capability: "00".repeat(32),
          request: signedResult.result,
        }),
        { msg: "error", result: "Provisioning capability is invalid or expired" }
      );
      assert.deepStrictEqual(
        await invoke(submitRoute, {
          capability: "00".repeat(32),
          request: signedResult.result,
        }, "VERUS_DESKTOP_MAIN"),
        { msg: "error", result: "Provisioning transport is restricted to Login Consent" }
      );
      assert.strictEqual(requests.length, 3);

      // Other builtin callers retain the pre-existing signing API contract;
      // only the Login Consent renderer is required to present a capability.
      const mainAppSign = await invoke(
        signRoute,
        {
          chainTicker: "VRSC",
          request: unsignedProvisioningRequest("iRQZGW36o3RcVR1xyVT1qWdAKdxp3wUyrh").toJson(),
          raddress: SIGNING_ADDRESS,
        },
        "VERUS_DESKTOP_MAIN"
      );
      assert.strictEqual(mainAppSign.msg, "success");
    });
  });

  describe("original request binding", function () {
    it("propagates asynchronous consent-plugin startup failures", async function () {
      const api = {
        setPost() {},
        async startPlugin() {
          throw new Error("consent plugin failed to start");
        },
      };

      require("../routes/api/plugin/builtin/loginconsentui")(api, {
        httpClient: { async post() {} },
        shell: { async openExternal() {} },
      });

      await assert.rejects(
        api.loginConsentUi.request(
          provisioningLoginRequest().toJson(),
          { id: "VERUS_DESKTOP_MAIN", search_builtin: true }
        ),
        /failed to start/
      );
    });

    it("rejects a malformed request before opening a consent window", async function () {
      let pluginStarted = false;
      const api = {
        setPost() {},
        startPlugin() {
          pluginStarted = true;
        },
      };

      require("../routes/api/plugin/builtin/loginconsentui")(api, {
        httpClient: { async post() {} },
        shell: { async openExternal() {} },
      });

      await assert.rejects(
        api.loginConsentUi.request(
          { challenge: { redirect_uris: [] } },
          { id: "VERUS_DESKTOP_MAIN", search_builtin: true }
        )
      );
      assert.strictEqual(pluginStarted, false);
    });

    it("only accepts an exact redirect captured from the request", function () {
      const originalRedirect = {
        uri: "https://callback.example.com/consent?state=signed",
        vdxfkey: WEBHOOK_KEY,
      };
      const request = {
        challenge: {
          redirect_uris: [originalRedirect],
        },
      };
      const snapshot = snapshotRequestRedirects(request);

      originalRedirect.uri = "https://attacker.example/collect";
      assert.deepStrictEqual(
        bindRedirectToRequest(
          {
            uri: "https://callback.example.com/consent?state=signed",
            vdxfkey: WEBHOOK_KEY,
          },
          snapshot
        ),
        {
          uri: "https://callback.example.com/consent?state=signed",
          vdxfkey: WEBHOOK_KEY,
        }
      );

      assert.throws(
        () => bindRedirectToRequest(originalRedirect, snapshot),
        /not present in the original request/
      );
      assert.throws(
        () => bindRedirectToRequest(
          {
            uri: "https://callback.example.com/consent?state=signed",
            vdxfkey: "attacker-selected-type",
          },
          snapshot
        ),
        /not present in the original request/
      );
    });

    it("rejects a consent-window callback that was not in the request", async function () {
      let postCalled = false;
      const api = {
        setPost() {},
        startPlugin(id, builtin, onResult) {
          assert.strictEqual(builtin, true);
          Promise.resolve(onResult({
            response: { approved: true },
            redirect: {
              uri: "https://attacker.example/collect",
              vdxfkey: WEBHOOK_KEY,
            },
          })).catch(() => {});
        },
      };

      require("../routes/api/plugin/builtin/loginconsentui")(api, {
        lookup: publicLookup,
        httpClient: {
          async post() { postCalled = true; },
        },
        shell: { async openExternal() {} },
      });

      const request = provisioningLoginRequest().toJson();
      request.challenge.redirect_uris = [{
        uri: "https://callback.example.com/consent",
        vdxfkey: WEBHOOK_KEY,
      }];

      await assert.rejects(
        api.loginConsentUi.request(
          request,
          { id: "VERUS_DESKTOP_MAIN", search_builtin: true }
        ),
        /not present in the original request/
      );
      assert.strictEqual(postCalled, false);
    });

    it("posts an exact safe webhook with the hardened transport policy", async function () {
      let posted;
      const api = {
        setPost() {},
        startPlugin(id, builtin, onResult) {
          Promise.resolve(onResult({
            response: { approved: true },
            redirect: {
              uri: "https://callback.example.com/consent",
              vdxfkey: WEBHOOK_KEY,
            },
          })).catch(() => {});
        },
      };

      require("../routes/api/plugin/builtin/loginconsentui")(api, {
        lookup: publicLookup,
        httpClient: {
          async post(url, body, config) { posted = { url, body, config }; },
        },
        shell: { async openExternal() {} },
      });

      const request = provisioningLoginRequest().toJson();
      request.challenge.redirect_uris = [{
        uri: "https://callback.example.com/consent",
        vdxfkey: WEBHOOK_KEY,
      }];

      const response = await api.loginConsentUi.request(
        request,
        { id: "VERUS_DESKTOP_MAIN", search_builtin: true }
      );

      assert.deepStrictEqual(response, { approved: true });
      assert.strictEqual(posted.url, "https://callback.example.com/consent");
      assert.deepStrictEqual(posted.body, { approved: true });
      assert.strictEqual(posted.config.maxRedirects, 0);
      assert.strictEqual(posted.config.proxy, false);
    });
  });
});
