const assert = require("assert");
const { describe, it } = require("node:test");
const {
  LOGIN_CONSENT_REDIRECT_VDXF_KEY,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
} = require("verus-typescript-primitives");
const {
  CALLBACK_MAX_BYTES,
  CALLBACK_TIMEOUT_MS,
  bindRedirectToRequest,
  createWebhookRequestConfig,
  isPublicIpAddress,
  parseBrowserRedirectUrl,
  parsePublicHttpsUrl,
  postWebhookWithDeadline,
  resolvePublicHttpsUrl,
  snapshotRequestRedirects,
} = require("../routes/api/utils/loginConsentSecurity");

const WEBHOOK_KEY = LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid;
const BROWSER_REDIRECT_KEY = LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid;

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
          { challenge: { redirect_uris: [] } },
          { id: "VERUS_DESKTOP_MAIN", search_builtin: true }
        ),
        /failed to start/
      );
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

      await assert.rejects(
        api.loginConsentUi.request(
          {
            challenge: {
              redirect_uris: [{
                uri: "https://callback.example.com/consent",
                vdxfkey: WEBHOOK_KEY,
              }],
            },
          },
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

      const response = await api.loginConsentUi.request(
        {
          challenge: {
            redirect_uris: [{
              uri: "https://callback.example.com/consent",
              vdxfkey: WEBHOOK_KEY,
            }],
          },
        },
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
