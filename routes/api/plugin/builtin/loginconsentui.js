const axios = require('axios');
const {
  LOGIN_CONSENT_ID_PROVISIONING_WEBHOOK_VDXF_KEY,
  LOGIN_CONSENT_RESPONSE_VDXF_KEY,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
  LOGIN_CONSENT_REDIRECT_VDXF_KEY,
  LoginConsentProvisioningRequest,
  LoginConsentRequest,
  LoginConsentResponse,
} = require("verus-typescript-primitives");
const { createHash, randomBytes, timingSafeEqual } = require("crypto");
const { pushMessage } = require('../../../ipc/ipc');
const { ReservedPluginTypes } = require('../../utils/plugin/builtin');
const { shell } = require('electron');
const base64url = require('base64url');
const {
  CALLBACK_MAX_BYTES,
  bindRedirectToRequest,
  createWebhookRequestConfig,
  getWebhookWithDeadline,
  parseBrowserRedirectUrl,
  parsePublicHttpsUrl,
  postWebhookWithDeadline,
  snapshotRequestRedirects,
} = require('../../utils/loginConsentSecurity');

const PROVISIONING_CAPABILITY_BYTES = 32;
const PROVISIONING_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const PROVISIONING_MAX_VERIFICATION_ATTEMPTS = 3;
const PROVISIONING_MAX_SIGN_ATTEMPTS = 8;
const PROVISIONING_MAX_SUBMISSIONS = 8;
const PROVISIONING_MAX_STATUS_REQUESTS = 32;
const PROVISIONING_MAX_STATUS_URIS = 4;
const PROVISIONING_STATUS_MIN_INTERVAL_MS = 1000;

module.exports = (api, dependencies = {}) => {
  const httpClient = dependencies.httpClient || axios;
  const externalShell = dependencies.shell || shell;
  const lookup = dependencies.lookup;
  const now = dependencies.now || Date.now;

  const requireLoginConsentCaller = (req) => {
    if (
      req == null ||
      req.api_header == null ||
      req.api_header.builtin !== true ||
      req.api_header.app_id !== ReservedPluginTypes.VERUS_LOGIN_CONSENT_UI
    ) {
      throw new Error("Provisioning transport is restricted to Login Consent");
    }
  };

  const parseProvisioningServiceResponse = (response) => {
    let value = response && response.data;
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > CALLBACK_MAX_BYTES) {
        throw new Error("Provisioning service response is too large");
      }
      try {
        value = JSON.parse(value);
      } catch (error) {
        throw new Error("Provisioning service returned invalid JSON");
      }
    }
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Provisioning service returned an invalid response");
    }
    return value;
  };

  api.loginConsentUi = {}
  const pendingRequests = new Map();

  const requestFingerprint = (request) => createHash("sha256")
    .update(new LoginConsentRequest(request).toBuffer())
    .digest("hex");

  const responseRequestFingerprint = (response) => {
    const parsedResponse = new LoginConsentResponse(response);
    return requestFingerprint(parsedResponse.decision.request);
  };

  const provisioningRequestFingerprint = (request) => createHash("sha256")
    .update(new LoginConsentProvisioningRequest(request).toBuffer())
    .digest("hex");

  const stableJsonValue = (value) => {
    if (Array.isArray(value)) return value.map(stableJsonValue);
    if (value != null && typeof value === "object") {
      return Object.keys(value).sort().reduce((result, key) => {
        if (value[key] !== undefined) result[key] = stableJsonValue(value[key]);
        return result;
      }, {});
    }
    return value;
  };

  const exactRequestSnapshot = (request) => {
    // First use the value's normal JSON representation (including toJSON on
    // primitive class instances), exactly as the API response transport does.
    const transportValue = JSON.parse(JSON.stringify(request));
    const value = stableJsonValue(transportValue);
    const serialized = JSON.stringify(value);
    return Object.freeze({
      serialized,
      value,
    });
  };

  const unsignedProvisioningRequestFingerprint = (request) => {
    const parsed = new LoginConsentProvisioningRequest(request);
    parsed.signature = undefined;
    return createHash("sha256").update(parsed.toBuffer()).digest("hex");
  };

  const provisioningWebhookForRequest = (request) => {
    const parsedRequest = new LoginConsentRequest(request);
    const matches = (parsedRequest.challenge.provisioning_info || []).filter(
      (item) => item.vdxfkey === LOGIN_CONSENT_ID_PROVISIONING_WEBHOOK_VDXF_KEY.vdxfid
    );

    if (matches.length === 0) return null;
    if (matches.length !== 1 || typeof matches[0].data !== "string") {
      throw new Error("Login consent request must contain exactly one provisioning webhook");
    }

    // Reject an unusable/unsafe endpoint before issuing a capability. DNS is
    // still resolved and pinned immediately before each outbound request.
    parsePublicHttpsUrl(matches[0].data);
    return matches[0].data;
  };

  const decodeProvisioningCapability = (capability) => {
    if (
      typeof capability !== "string" ||
      capability.length !== PROVISIONING_CAPABILITY_BYTES * 2 ||
      !/^[0-9a-f]+$/i.test(capability)
    ) {
      return null;
    }
    return Buffer.from(capability, "hex");
  };

  const findProvisioningEntry = (
    capability,
    { requireFocus = true, requireVisibility = true } = {}
  ) => {
    const received = decodeProvisioningCapability(capability);
    let match = null;

    // Do not use a capability string as a Map key. Compare all live sessions
    // in constant time so a shared builtin API secret cannot become an oracle
    // for partially-correct capability values.
    for (const [windowId, entry] of pendingRequests.entries()) {
      const expected = entry.provisioning && entry.provisioning.capability;
      if (
        received != null &&
        Buffer.isBuffer(expected) &&
        expected.length === received.length &&
        timingSafeEqual(expected, received)
      ) {
        match = { windowId, entry };
      }
    }

    if (match == null) {
      throw new Error("Provisioning capability is invalid or expired");
    }

    const { windowId, entry } = match;
    if (now() - entry.provisioning.createdAt > PROVISIONING_SESSION_MAX_AGE_MS) {
      pendingRequests.delete(windowId);
      throw new Error("Provisioning capability is invalid or expired");
    }
    if (!pendingEntryIsLive(entry)) {
      throw new Error("The corresponding Login Consent window is no longer active");
    }
    if (requireVisibility && !pendingEntryIsLiveAndVisible(entry)) {
      throw new Error("The corresponding Login Consent window must be live and visible");
    }
    if (requireFocus && !pendingEntryIsInteractive(entry)) {
      throw new Error("The corresponding Login Consent window must be visible and focused");
    }

    return match;
  };

  const assertSameProvisioningChallenge = (entry, request) => {
    const parsed = new LoginConsentProvisioningRequest(request);
    if (
      parsed.challenge == null ||
      parsed.challenge.challenge_id !== entry.provisioning.challengeId
    ) {
      throw new Error("Provisioning request does not belong to this login-consent session");
    }
    return parsed;
  };

  const addLearnedStatusUri = (entry, response) => {
    const infoUri = response && response.decision && response.decision.result &&
      response.decision.result.info_uri;
    if (infoUri == null || infoUri === "") return;
    if (typeof infoUri !== "string") {
      throw new Error("Provisioning service returned an invalid status URI");
    }

    // Validate synchronously now and resolve/pin DNS only if it is later used.
    parsePublicHttpsUrl(infoUri);
    const statusUris = entry.provisioning.statusUris;
    if (!statusUris.has(infoUri) && statusUris.size >= PROVISIONING_MAX_STATUS_URIS) {
      throw new Error("Provisioning service returned too many status URIs");
    }
    statusUris.add(infoUri);
  };

  const pendingEntryIsLive = (entry) => {
    const window = entry && entry.window;
    return window != null &&
      (typeof window.isDestroyed !== "function" || !window.isDestroyed()) &&
      (window.webContents == null || typeof window.webContents.isDestroyed !== "function" ||
        !window.webContents.isDestroyed());
  };

  const pendingEntryIsLiveAndVisible = (entry) => {
    const window = entry && entry.window;
    return pendingEntryIsLive(entry) &&
      (typeof window.isVisible !== "function" || window.isVisible());
  };

  const pendingEntryIsInteractive = (entry) => {
    const window = entry && entry.window;
    return pendingEntryIsLiveAndVisible(entry) &&
      (typeof window.isFocused !== "function" || window.isFocused());
  };

  api.loginConsentUi.beginProvisioningRequestVerification = (
    capability,
    request
  ) => {
    const { windowId, entry } = findProvisioningEntry(capability);
    const session = entry.provisioning;
    if (session.verificationInFlight) {
      throw new Error("Login consent request verification is already in progress");
    }
    if (session.verificationAttempts >= PROVISIONING_MAX_VERIFICATION_ATTEMPTS) {
      throw new Error("Login consent verification limit reached for this consent session");
    }
    if (requestFingerprint(request) !== entry.fingerprint) {
      throw new Error("Login consent request does not belong to this provisioning session");
    }

    session.verificationAttempts += 1;
    session.verificationInFlight = true;
    let finished = false;
    return Object.freeze({
      confirm() {
        if (finished) throw new Error("Login consent verification claim is no longer active");
        if (pendingRequests.get(windowId) !== entry || !pendingEntryIsLive(entry)) {
          throw new Error("The corresponding Login Consent window is no longer active");
        }
        session.requestVerified = true;
        session.verificationInFlight = false;
        finished = true;
      },
      release() {
        if (finished) return;
        session.verificationInFlight = false;
        finished = true;
      },
    });
  };

  api.loginConsentUi.beginProvisioningSigning = (
    capability,
    request,
    signingAddress
  ) => {
    const { windowId, entry } = findProvisioningEntry(capability);
    const session = entry.provisioning;
    if (session.requestVerified !== true) {
      throw new Error("The original login consent request has not been verified");
    }
    if (session.signingInFlight) {
      throw new Error("A provisioning signing request is already in progress");
    }
    if (session.signAttempts >= PROVISIONING_MAX_SIGN_ATTEMPTS) {
      throw new Error("Provisioning signing limit reached for this consent session");
    }

    const parsed = assertSameProvisioningChallenge(entry, request);
    if (parsed.signature != null) {
      throw new Error("Provisioning request must be unsigned before wallet signing");
    }
    if (
      typeof signingAddress !== "string" ||
      parsed.signing_address !== signingAddress
    ) {
      throw new Error("Provisioning signing address does not match the request");
    }

    const unsignedFingerprint = unsignedProvisioningRequestFingerprint(parsed);
    session.signAttempts += 1;
    session.signingInFlight = true;
    let finished = false;
    return Object.freeze({
      register(signedRequest) {
        if (finished) throw new Error("Provisioning signing claim is no longer active");
        const current = pendingRequests.get(windowId);
        if (current !== entry || !pendingEntryIsInteractive(entry)) {
          throw new Error("The corresponding Login Consent window is no longer active");
        }
        const signed = assertSameProvisioningChallenge(entry, signedRequest);
        if (signed.signature == null) {
          throw new Error("Wallet did not return a signed provisioning request");
        }
        if (unsignedProvisioningRequestFingerprint(signed) !== unsignedFingerprint) {
          throw new Error("Wallet returned a different provisioning request after signing");
        }
        session.signedRequests.set(
          provisioningRequestFingerprint(signed),
          exactRequestSnapshot(signedRequest)
        );
        session.signingInFlight = false;
        finished = true;
      },
      release() {
        if (finished) return;
        session.signingInFlight = false;
        finished = true;
      },
    });
  };

  api.loginConsentUi.beginProvisioningSubmission = (capability, request) => {
    const { windowId, entry } = findProvisioningEntry(capability);
    const session = entry.provisioning;
    if (session.submissionInFlight) {
      throw new Error("A provisioning submission is already in progress");
    }
    if (session.submissions >= PROVISIONING_MAX_SUBMISSIONS) {
      throw new Error("Provisioning submission limit reached for this consent session");
    }

    const signed = assertSameProvisioningChallenge(entry, request);
    if (signed.signature == null) {
      throw new Error("Provisioning request must be signed");
    }
    const fingerprint = provisioningRequestFingerprint(signed);
    const registeredRequest = session.signedRequests.get(fingerprint);
    const submittedRequest = exactRequestSnapshot(request);
    if (
      registeredRequest == null ||
      registeredRequest.serialized !== submittedRequest.serialized
    ) {
      throw new Error("Provisioning request was not signed for this consent session or was already submitted");
    }
    session.signedRequests.delete(fingerprint);

    session.submissions += 1;
    session.submissionInFlight = true;
    let finished = false;
    return Object.freeze({
      uri: session.webhookUri,
      request: registeredRequest.value,
      recordResponse(response) {
        if (finished) throw new Error("Provisioning submission claim is no longer active");
        if (pendingRequests.get(windowId) !== entry || !pendingEntryIsLive(entry)) {
          throw new Error("The corresponding Login Consent window is no longer active");
        }
        addLearnedStatusUri(entry, response);
      },
      release() {
        if (finished) return;
        session.submissionInFlight = false;
        finished = true;
      },
    });
  };

  api.loginConsentUi.beginProvisioningStatusRequest = (capability, uri) => {
    const { windowId, entry } = findProvisioningEntry(capability, {
      requireFocus: false,
      requireVisibility: false,
    });
    const session = entry.provisioning;
    const requestedAt = now();
    if (session.statusInFlight) {
      throw new Error("A provisioning status request is already in progress");
    }
    if (session.statusRequests >= PROVISIONING_MAX_STATUS_REQUESTS) {
      throw new Error("Provisioning status request limit reached for this consent session");
    }
    if (typeof uri !== "string" || !session.statusUris.has(uri)) {
      throw new Error("Provisioning status URI was not issued for this consent session");
    }
    if (requestedAt - session.lastStatusAt < PROVISIONING_STATUS_MIN_INTERVAL_MS) {
      throw new Error("Provisioning status requests are being made too quickly");
    }

    session.statusRequests += 1;
    session.lastStatusAt = requestedAt;
    session.statusInFlight = true;
    let finished = false;
    return Object.freeze({
      uri,
      recordResponse(response) {
        if (finished) throw new Error("Provisioning status claim is no longer active");
        if (pendingRequests.get(windowId) !== entry || !pendingEntryIsLive(entry)) {
          throw new Error("The corresponding Login Consent window is no longer active");
        }
        addLearnedStatusUri(entry, response);
      },
      release() {
        if (finished) return;
        session.statusInFlight = false;
        finished = true;
      },
    });
  };

  const matchingPendingEntries = (response) => {
    const fingerprint = responseRequestFingerprint(response);
    return [...pendingRequests.entries()].filter(([, entry]) =>
      entry.fingerprint === fingerprint &&
      entry.inFlight !== true &&
      pendingEntryIsInteractive(entry)
    );
  };

  api.loginConsentUi.hasPendingResponse = (response) => {
    try {
      return matchingPendingEntries(response).length === 1;
    } catch (error) {
      return false;
    }
  };

  api.loginConsentUi.beginPendingResponse = (response) => {
    const matches = matchingPendingEntries(response);
    if (matches.length !== 1) {
      throw new Error("No matching focused login-consent request is pending");
    }
    const [windowId, entry] = matches[0];
    entry.inFlight = true;
    const claimId = randomBytes(16).toString("hex");
    entry.claimId = claimId;
    let finished = false;
    return Object.freeze({
      consume() {
        if (finished) return;
        finished = true;
        const current = pendingRequests.get(windowId);
        if (current === entry && current.claimId === claimId) pendingRequests.delete(windowId);
      },
      release() {
        if (finished) return;
        finished = true;
        const current = pendingRequests.get(windowId);
        if (current === entry && current.claimId === claimId) {
          current.inFlight = false;
          delete current.claimId;
        }
      },
    });
  };

  api.loginConsentUi.handle_redirect = async (response, redirectinfo) => {
    const { vdxfkey, uri } = redirectinfo

    const handlers = new Map([
      [LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid, async () => {
        const { url, config } = await createWebhookRequestConfig(uri, { lookup });
        await postWebhookWithDeadline(httpClient, url, response, config);
        return null;
      }],
      [LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid, async () => {
        const url = parseBrowserRedirectUrl(uri);

        const res = new LoginConsentResponse(response)
        url.searchParams.set(
          LOGIN_CONSENT_RESPONSE_VDXF_KEY.vdxfid,
          base64url(res.toBuffer())
        );
        
        await externalShell.openExternal(url.toString())
        return null
      }],
    ]);

    const handler = handlers.get(vdxfkey);
    if (handler == null) {
      throw new Error("Unsupported login consent redirect type");
    }

    return handler();
  }

  api.setPost(
    "/native/verusid/provision/submit_id_provisioning_request",
    async (req, res) => {
      let submissionClaim = null;
      try {
        requireLoginConsentCaller(req);
        const { capability, request } = req.body || {};
        if (request == null || typeof request !== "object" || Array.isArray(request)) {
          throw new Error("Provisioning request must be an object");
        }
        const serializedRequest = JSON.stringify(request);
        if (Buffer.byteLength(serializedRequest, "utf8") > CALLBACK_MAX_BYTES) {
          throw new Error("Provisioning request is too large");
        }
        submissionClaim = api.loginConsentUi.beginProvisioningSubmission(
          capability,
          request
        );
        const { url, config } = await createWebhookRequestConfig(
          submissionClaim.uri,
          { lookup }
        );
        const response = await postWebhookWithDeadline(
          httpClient,
          url,
          submissionClaim.request,
          config
        );
        const parsedResponse = parseProvisioningServiceResponse(response);
        submissionClaim.recordResponse(parsedResponse);
        res.send(JSON.stringify({
          msg: "success",
          result: parsedResponse,
        }));
      } catch (error) {
        res.send(JSON.stringify({ msg: "error", result: error.message }));
      } finally {
        if (submissionClaim != null) submissionClaim.release();
      }
    },
    true
  );

  api.setPost(
    "/native/verusid/provision/get_id_provisioning_status",
    async (req, res) => {
      let statusClaim = null;
      try {
        requireLoginConsentCaller(req);
        const { capability, uri } = req.body || {};
        statusClaim = api.loginConsentUi.beginProvisioningStatusRequest(
          capability,
          uri
        );
        const { url, config } = await createWebhookRequestConfig(
          statusClaim.uri,
          { lookup }
        );
        const response = await getWebhookWithDeadline(httpClient, url, config);
        const parsedResponse = parseProvisioningServiceResponse(response);
        statusClaim.recordResponse(parsedResponse);
        res.send(JSON.stringify({
          msg: "success",
          result: parsedResponse,
        }));
      } catch (error) {
        res.send(JSON.stringify({ msg: "error", result: error.message }));
      } finally {
        if (statusClaim != null) statusClaim.release();
      }
    },
    true
  );

  api.loginConsentUi.request = async (
    request,
    originInfo
  ) => {
    return new Promise((resolve, reject) => {
      try {
        const requestRedirects = snapshotRequestRedirects(request);
        // Validate and fingerprint before opening a window. Deferring this to
        // did-finish-load would turn malformed input into an uncaught timer
        // exception and leave the caller waiting forever.
        const pendingFingerprint = requestFingerprint(request);
        let pendingWindowId = null;

        const pluginStart = api.startPlugin(
          ReservedPluginTypes.VERUS_LOGIN_CONSENT_UI,
          true,
          async (data) => {
            try {
              if (data.redirect) {
                const boundRedirect = bindRedirectToRequest(data.redirect, requestRedirects);
                await api.loginConsentUi.handle_redirect(data.response, boundRedirect);
              }

              resolve(data.response);
            } catch(e) {
              reject(e)
            } finally {
              if (pendingWindowId != null) pendingRequests.delete(pendingWindowId);
            }
          },
          (pluginWindow) => {
            pendingWindowId = pluginWindow.id;
            let provisioning = null;
            try {
              const webhookUri = provisioningWebhookForRequest(request);
              if (webhookUri != null) {
                const capability = randomBytes(PROVISIONING_CAPABILITY_BYTES);
                provisioning = {
                  capability,
                  challengeId: new LoginConsentRequest(request).challenge.challenge_id,
                  createdAt: now(),
                  webhookUri,
                  requestVerified: false,
                  verificationAttempts: 0,
                  verificationInFlight: false,
                  signAttempts: 0,
                  signingInFlight: false,
                  signedRequests: new Map(),
                  submissions: 0,
                  submissionInFlight: false,
                  statusUris: new Set(),
                  statusRequests: 0,
                  statusInFlight: false,
                  lastStatusAt: 0,
                };
              }
            } catch (error) {
              if (typeof api.log === "function") {
                api.log(error, "loginConsentUi.provisioningCapability");
              }
            }

            const pendingEntry = {
              fingerprint: pendingFingerprint,
              inFlight: false,
              window: pluginWindow,
              provisioning,
            };
            pendingRequests.set(pluginWindow.id, pendingEntry);
            if (typeof pluginWindow.once === "function") {
              pluginWindow.once("closed", () => pendingRequests.delete(pluginWindow.id));
            }
            pushMessage(
              pluginWindow,
              {
                request: request,
                origin_app_info: originInfo,
                provisioning_capability:
                  provisioning == null
                    ? null
                    : provisioning.capability.toString("hex"),
              },
              "VERUS_LOGIN_CONSENT_REQUEST"
            );
          },
          830,
          550,
          false
        );

        Promise.resolve(pluginStart).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  };

  api.setPost('/plugin/builtin/verus_login_consent_ui/request', async (req, res, next) => {
    const { request } = req.body;
    const { app_id, builtin } = req.api_header
   
    try {
      const retObj = {
        msg: "success",
        result: await api.loginConsentUi.request(
          request,
          {
            id: app_id,
            search_builtin: builtin,
          }
        ),
      };

      res.send(JSON.stringify(retObj));
    } catch (e) {
      const retObj = {
        msg: 'error',
        result: e.message,
      };

      res.send(JSON.stringify(retObj));
    }
  });

  return api;
};
