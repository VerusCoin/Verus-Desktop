"use strict";

const { createHash } = require("crypto");
const { escapeInvisibleCharacters } = require("./terminalRpcSecurity");
const { AUTHORIZATION_SCOPES } = require("./nativeAuthorization");
const nativeSecurity = require("./security");

const IRREVERSIBLE_AUTH_SETTING = "requireNativeAuthForIrreversibleActions";
const MAIN_APPLICATION_ID = "VERUS_DESKTOP_MAIN";
const LOGIN_CONSENT_APPLICATION_ID = "VERUS_LOGIN_CONSENT_UI";
const MAX_DISPLAY_STRING = 512;
const MAX_DISPLAY_ARRAY = 30;
const MAX_DISPLAY_KEYS = 50;
const MAX_DISPLAY_DEPTH = 6;
const MAX_DISPLAY_JSON = 12 * 1024;

const SECRET_PROPERTY = /(?:^|_)(?:key|privatekey|privkey|password|passphrase|salt|secret|seed|wif)(?:$|_)/i;
const OPAQUE_CONTENT_PROPERTY = /^(?:contentmap|data|memo|opreturn)$/i;

const isSecretProperty = (property) => {
  if (SECRET_PROPERTY.test(property)) return true;
  const compact = String(property).replace(/[^0-9a-z]/gi, "").toLowerCase();
  if (
    /(?:privatekey|privkey|password|passphrase|secret|seed|wif|salt|mnemonic|xprv|apikey|authkey|walletkey)/.test(compact)
  ) {
    return true;
  }
  return compact.endsWith("key") && !compact.endsWith("publickey") && !compact.endsWith("pubkey");
};

const spec = (label, fields, options = {}) => Object.freeze({
  label,
  fields: Object.freeze(fields.slice()),
  ...options,
});

const IRREVERSIBLE_ROUTE_SPECS = Object.freeze({
  "/native/sendtx": spec("Send native funds or post transaction data", [
    "chainTicker", "fromAddress", "toAddress", "amount", "customFee", "currencyParams", "memo",
  ]),
  "/native/sendcurrency": spec("Send, convert, mint, or export currency", [
    "chainTicker", "from", "outputs", "feeamount",
  ], { detailFormat: "sendcurrency" }),
  "/electrum/sendtx": spec("Sign and broadcast a Lite-wallet transaction", [
    "chainTicker", "customFromAddress", "toAddress", "amount", "lumpFee", "feePerByte",
    "verify", "noSigature", "offlineTx", "unsigned", "customUtxos", "votingTx",
    "opreturn", "customWif",
  ]),
  "/eth/sendtx": spec("Send Ethereum funds", ["toAddress", "amount"]),
  "/erc20/sendtx": spec("Send ERC-20 funds", ["chainTicker", "toAddress", "amount"]),
  "/native/register_id_name": spec("Commit an identity name on-chain", [
    "chainTicker", "name", "referralId", "primaryAddress",
  ]),
  "/native/register_id": spec("Register an identity on-chain", [
    "chainTicker", "name", "txid", "primaryaddresses", "minimumsignatures", "contentmap",
    "revocationauthority", "recoveryauthority", "privateaddress", "idFee", "referral", "parent", "version",
  ]),
  "/native/revoke_id": spec("Revoke an identity on-chain", ["chainTicker", "name"]),
  "/native/recover_id": spec("Recover an identity on-chain", [
    "chainTicker", "name", "primaryaddresses", "minimumsignatures", "contentmap",
    "revocationauthority", "recoveryauthority", "privateaddress",
  ]),
  "/native/update_id": spec("Update an identity on-chain", [
    "chainTicker", "name", "primaryaddresses", "minimumsignatures", "contentmap",
    "revocationauthority", "recoveryauthority", "privateaddress",
  ]),
  "/native/setidentitytimelock": spec("Change an identity timelock on-chain", [
    "chain", "identity", "lock",
  ]),
  "/native/makeoffer": spec("Create an on-chain offer", []),
  "/native/takeoffer": spec("Accept an on-chain offer", ["chain", "fromaddress", "offer"]),
  "/native/closeoffers": spec("Close on-chain offers", ["chain", "offers"]),
  "/native/shieldcoinbase": spec("Shield coinbase funds", [
    "chainTicker", "fromAddress", "toAddress", "fee", "limit",
  ]),
  "/native/sign_message": spec("Create a wallet-authority signature", [
    "chainTicker", "address", "data", "cursig",
  ], { signingOnly: true }),
  "/native/sign_file": spec("Create a wallet-authority file signature", [
    "chainTicker", "address", "data", "cursig",
  ], { signingOnly: true }),
  "/native/verusid/login/sign_response": spec("Sign a VerusID login consent response", [
    "response",
  ], {
    signingOnly: true,
    detailFormat: "login-consent-response",
    allowedCallerIds: [MAIN_APPLICATION_ID, LOGIN_CONSENT_APPLICATION_ID],
    alwaysRestrictCaller: true,
  }),
  "/native/verusid/provision/sign_id_provisioning_request": spec(
    "Sign a VerusID provisioning request",
    ["chainTicker", "request", "raddress"],
    {
      signingOnly: true,
      detailFormat: "provisioning-request",
      allowedCallerIds: [MAIN_APPLICATION_ID, LOGIN_CONSENT_APPLICATION_ID],
      alwaysRestrictCaller: true,
    }
  ),
  "/native/start_mining": spec("Enable mining", ["chainTicker", "numThreads"]),
  "/native/start_staking": spec("Enable staking", ["chainTicker"]),
  "/native/start_bridgekeeper": spec("Start BridgeKeeper on-chain processing", ["chainTicker"]),
  "/native/bridgekeeper_setconf": spec("Change BridgeKeeper signing configuration", [
    "chainTicker", "infuraLink", "ethContract",
  ]),
});

const ALWAYS_AUTHORIZED_ROUTE_SPECS = Object.freeze({
  "/native/exportwallet": spec("Export unencrypted wallet private keys", [
    "chain", "filename", "omitemptyaddresses",
  ]),
  "/native/importwallet": spec("Import wallet private keys", ["chain", "filename"]),
});

const isPlainObject = (value) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const summarizeOpaqueValue = (value) => {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    serialized = String(value);
  }
  if (serialized == null) serialized = String(value);
  return {
    summary: "Content hidden from the prompt; verify it in Verus Desktop before approving.",
    bytes: Buffer.byteLength(serialized, "utf8"),
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
};

const canonicalizeJson = (value, state, depth = 0) => {
  state.nodes += 1;
  if (state.nodes > 100000 || depth > 100) {
    throw new TypeError("Protected action payload is too complex to fingerprint safely");
  }
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Protected action payload contains an invalid number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) {
      throw new TypeError("Protected action payload cannot contain cycles");
    }
    state.ancestors.add(value);
    const serialized = `[${value
      .map((item) => canonicalizeJson(item, state, depth + 1))
      .join(",")}]`;
    state.ancestors.delete(value);
    return serialized;
  }
  if (!isPlainObject(value)) {
    throw new TypeError("Protected action payload contains an unsupported value");
  }
  if (state.ancestors.has(value)) {
    throw new TypeError("Protected action payload cannot contain cycles");
  }
  state.ancestors.add(value);
  const serialized = `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key], state, depth + 1)}`)
    .join(",")}}`;
  state.ancestors.delete(value);
  return serialized;
};

const createCanonicalPayloadFingerprint = (value) => {
  const canonicalJson = canonicalizeJson(value, {
    ancestors: new Set(),
    nodes: 0,
  });
  return {
    summary: "SHA-256 of the complete request encoded as canonical JSON.",
    bytes: Buffer.byteLength(canonicalJson, "utf8"),
    sha256: createHash("sha256").update(canonicalJson).digest("hex"),
  };
};

const displayLimit = (state, fallback) => {
  if (state.failOnTruncation) {
    throw new TypeError(
      "Protected action details cannot be displayed completely; the operation was not authorized"
    );
  }
  return fallback;
};

const sanitizeDisplayValue = (value, state, depth = 0, property = "") => {
  state.nodes += 1;
  if (state.nodes > state.maxNodes) {
    return displayLimit(state, "[TRUNCATED: too many values]");
  }
  if (depth > state.maxDepth) {
    return displayLimit(state, "[TRUNCATED: nesting limit]");
  }
  if (OPAQUE_CONTENT_PROPERTY.test(property)) return summarizeOpaqueValue(value);
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[INVALID NUMBER]";
  if (typeof value === "string") {
    const escaped = escapeInvisibleCharacters(value);
    return escaped.length <= state.maxString
      ? escaped
      : displayLimit(
          state,
          `${escaped.slice(0, state.maxString)}… [${escaped.length} characters]`
        );
  }
  if (Array.isArray(value)) {
    if (value.length > state.maxArray && state.failOnTruncation) {
      displayLimit(state);
    }
    const displayed = value
      .slice(0, state.maxArray)
      .map((item) => sanitizeDisplayValue(item, state, depth + 1));
    if (value.length > state.maxArray) {
      displayed.push(`[TRUNCATED: ${value.length - state.maxArray} more items]`);
    }
    return displayed;
  }
  if (!isPlainObject(value)) return "[UNSUPPORTED VALUE]";

  const output = {};
  if (Object.keys(value).length > state.maxKeys && state.failOnTruncation) {
    displayLimit(state);
  }
  const entries = Object.entries(value).slice(0, state.maxKeys);
  for (const [rawKey, child] of entries) {
    const escapedKey = escapeInvisibleCharacters(rawKey);
    const key = escapedKey.length <= 256
      ? escapedKey
      : displayLimit(state, escapedKey.slice(0, 256));
    output[key] = isSecretProperty(rawKey)
      ? "[REDACTED: secret value]"
      : sanitizeDisplayValue(child, state, depth + 1, rawKey);
  }
  if (Object.keys(value).length > state.maxKeys) {
    output["[TRUNCATED]"] = `${Object.keys(value).length - state.maxKeys} more properties`;
  }
  return output;
};

const selectDisplayFields = (body, fields) => {
  if (fields.length === 0) return body;
  const selected = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) selected[field] = body[field];
  }
  return selected;
};

const formatActionDetails = (body, fields, options = {}) => {
  const failOnTruncation = options.failOnTruncation === true;
  const sanitized = sanitizeDisplayValue(
    selectDisplayFields(body, fields),
    {
      failOnTruncation,
      nodes: 0,
      maxNodes: options.maxNodes == null ? 1000 : options.maxNodes,
      maxDepth: options.maxDepth == null ? MAX_DISPLAY_DEPTH : options.maxDepth,
      maxString: options.maxString == null ? MAX_DISPLAY_STRING : options.maxString,
      maxArray: options.maxArray == null ? MAX_DISPLAY_ARRAY : options.maxArray,
      maxKeys: options.maxKeys == null ? MAX_DISPLAY_KEYS : options.maxKeys,
    }
  );
  let display = JSON.stringify(sanitized, null, 2);
  if (display.length > MAX_DISPLAY_JSON) {
    display = failOnTruncation
      ? displayLimit({ failOnTruncation })
      : `${display.slice(0, MAX_DISPLAY_JSON)}\n[TRUNCATED: prompt size limit]`;
  }
  return display;
};

const addPresentFields = (target, source, fields) => {
  if (!isPlainObject(source)) return target;
  for (const [outputName, sourceName] of fields) {
    if (Object.prototype.hasOwnProperty.call(source, sourceName)) {
      target[outputName] = source[sourceName];
    }
  }
  return target;
};

const formatLoginConsentDetails = (body, failOnTruncation) => {
  const response = isPlainObject(body.response) ? body.response : null;
  const decision = response && isPlainObject(response.decision) ? response.decision : null;
  const request = decision && isPlainObject(decision.request) ? decision.request : null;
  const challenge = request && isPlainObject(request.challenge) ? request.challenge : null;
  const client = challenge && isPlainObject(challenge.client) ? challenge.client : null;

  const summary = addPresentFields({}, body, [["chainTicker", "chainTicker"]]);
  addPresentFields(summary, response, [
    ["responseChainTicker", "chainTicker"],
    ["responseSystemId", "system_id"],
    ["responseChainId", "chain_id"],
    ["signingIdentity", "signing_id"],
  ]);
  summary.decision = addPresentFields({}, decision, [
    ["decisionId", "decision_id"],
    ["createdAt", "created_at"],
    ["subject", "subject"],
    ["remember", "remember"],
    ["rememberForSeconds", "remember_for"],
    ["forceSubjectIdentifier", "force_subject_identifier"],
    ["skipped", "skipped"],
  ]);
  summary.request = addPresentFields({}, request, [
    ["systemId", "system_id"],
    ["chainId", "chain_id"],
    ["signingIdentity", "signing_id"],
  ]);
  summary.challenge = addPresentFields({}, challenge, [
    ["challengeId", "challenge_id"],
    ["uuid", "uuid"],
    ["createdAt", "created_at"],
    ["requestedScope", "requested_scope"],
    ["requestedAccess", "requested_access"],
    ["requestedAudience", "requested_access_audience"],
    ["requestedTokenAudience", "requested_access_token_audience"],
    ["requestUrl", "request_url"],
    ["redirectUris", "redirect_uris"],
  ]);
  summary.client = addPresentFields({}, client, [
    ["clientId", "client_id"],
    ["name", "name"],
    ["scope", "scope"],
    ["audience", "audience"],
    ["redirectUris", "redirect_uris"],
    ["grantTypes", "grant_types"],
    ["responseTypes", "response_types"],
    ["policyUri", "policy_uri"],
    ["termsUri", "tos_uri"],
    ["clientUri", "client_uri"],
  ]);
  summary.canonicalPayloadFingerprint = createCanonicalPayloadFingerprint(body);

  return formatActionDetails(summary, [], {
    failOnTruncation,
    maxArray: Number.MAX_SAFE_INTEGER,
    maxDepth: 20,
    maxNodes: 10000,
  });
};

const formatProvisioningDetails = (body, failOnTruncation) => {
  const request = isPlainObject(body.request) ? body.request : null;
  const challenge = request && isPlainObject(request.challenge) ? request.challenge : null;
  const summary = addPresentFields({}, body, [
    ["chainTicker", "chainTicker"],
    ["signingAddress", "raddress"],
  ]);
  summary.request = addPresentFields({}, request, [
    ["requestSigningAddress", "signing_address"],
  ]);
  summary.challenge = addPresentFields({}, challenge, [
    ["challengeId", "challenge_id"],
    ["createdAt", "created_at"],
    ["name", "name"],
    ["systemId", "system_id"],
    ["parent", "parent"],
    ["context", "context"],
  ]);
  summary.canonicalPayloadFingerprint = createCanonicalPayloadFingerprint(body);

  return formatActionDetails(summary, [], {
    failOnTruncation,
    maxArray: Number.MAX_SAFE_INTEGER,
    maxDepth: 20,
    maxNodes: 10000,
  });
};

const formatSendcurrencyDetails = (body, failOnTruncation) => {
  const summary = selectDisplayFields(body, ["chainTicker", "from", "outputs", "feeamount"]);
  summary.outputCount = Array.isArray(body.outputs) ? body.outputs.length : "Invalid output list";
  summary.canonicalPayloadFingerprint = createCanonicalPayloadFingerprint(body);
  return formatActionDetails(summary, [], {
    failOnTruncation,
    // Valid sendcurrency batches are constrained by the native dialog's total
    // detail size, not by an arbitrary number of recipients. This keeps every
    // executable output visible or rejects the request before prompting.
    maxArray: Number.MAX_SAFE_INTEGER,
    maxNodes: 100000,
  });
};

const formatRouteActionDetails = (routeSpec, body, failOnTruncation) => {
  switch (routeSpec.detailFormat) {
    case "sendcurrency":
      return formatSendcurrencyDetails(body, failOnTruncation);
    case "login-consent-response":
      return formatLoginConsentDetails(body, failOnTruncation);
    case "provisioning-request":
      return formatProvisioningDetails(body, failOnTruncation);
    default:
      return formatActionDetails(body, routeSpec.fields, { failOnTruncation });
  }
};

const startupRequestEnablesChainWriting = (body, context) => {
  if (context.effectiveStartupSecurityState != null) {
    const state = context.effectiveStartupSecurityState;
    if (
      typeof state !== "object" ||
      typeof state.chainWriting !== "boolean" ||
      typeof state.fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(state.fingerprint)
    ) {
      throw new TypeError("Invalid effective daemon startup security state");
    }
    return state.chainWriting;
  }
  const check = nativeSecurity.hasChainWritingStartupOption;
  if (typeof check !== "function") return false;
  const startupOptions = [
    ...(Array.isArray(body.startupOptions) ? body.startupOptions : []),
    ...(body.launchConfig && Array.isArray(body.launchConfig.startupOptions)
      ? body.launchConfig.startupOptions
      : []),
  ];
  return check(startupOptions);
};

const createPrompt = (
  route,
  routeSpec,
  body,
  context,
  scope,
  failOnTruncation = true
) => {
  const caller = context.callerAppId === MAIN_APPLICATION_ID
    ? "Verus Desktop"
    : context.callerAppId === LOGIN_CONSENT_APPLICATION_ID
      ? "Verus Login"
      : "Verus Desktop";
  const signingOnly = routeSpec.signingOnly === true;
  const message = signingOnly
    ? "Verus Desktop is ready to create this signature."
    : "Verus Desktop is ready to complete this wallet action.";

  return Object.freeze({
    scope,
    actionId: route,
    ...(typeof context.callerAppId === "string"
      ? { callerAppId: context.callerAppId }
      : {}),
    title: signingOnly ? "Confirm Signature" : "Confirm Wallet Action",
    message,
    detail: [
      "This confirmation is a normal safety check. If you started this action and the details below are correct, there is nothing to worry about.",
      "",
      `Requested by: ${caller}`,
      `Action: ${routeSpec.label}`,
      "",
      "Details:",
      formatRouteActionDetails(routeSpec, body, failOnTruncation),
      "",
      "If you did not start this action, choose Cancel.",
    ].join("\n"),
    confirmLabel: signingOnly ? "Create Signature" : "Confirm",
  });
};

const createSettingDisablePrompt = () => Object.freeze({
  scope: AUTHORIZATION_SCOPES.SECURITY_SETTING,
  actionId: "/config/save:disable-irreversible-authorization",
  title: "Turn Off Wallet Confirmations?",
  message: "Verus Desktop is ready to turn off confirmations for most wallet actions.",
  detail:
    "If you changed this setting yourself, this confirmation is expected and there is nothing to worry about. " +
    "After it is turned off, Verus Desktop will no longer ask before most sends and other wallet changes. " +
    "Confirmations will still appear before showing private keys or seeds, importing or exporting a wallet, and running advanced terminal commands.\n\n" +
    "If you did not change this setting, choose Cancel.",
  confirmLabel: "Turn Off Confirmations",
});

const callerIsAllowed = (routeSpec, context) => {
  if (context.callerBuiltin !== true) return false;
  const allowedCallerIds = Array.isArray(routeSpec.allowedCallerIds)
    ? routeSpec.allowedCallerIds
    : [MAIN_APPLICATION_ID];
  return allowedCallerIds.includes(context.callerAppId);
};

const createApiAuthorizationRequest = (route, payload, context = {}) => {
  if (typeof route !== "string") return null;
  const gatedAuthorizationEnabled = context.irreversibleAuthorizationEnabled !== false;
  if (!isPlainObject(payload)) {
    if (
      Object.prototype.hasOwnProperty.call(IRREVERSIBLE_ROUTE_SPECS, route) ||
      Object.prototype.hasOwnProperty.call(ALWAYS_AUTHORIZED_ROUTE_SPECS, route)
    ) {
      throw new TypeError("Protected API payload must be an object");
    }
    return null;
  }

  if (route === "/config/save") {
    const candidateMain = payload.configObj && payload.configObj.general && payload.configObj.general.main;
    const currentMain = context.currentConfig && context.currentConfig.general && context.currentConfig.general.main;
    const currentlyEnabled = typeof context.irreversibleAuthorizationEnabled === "boolean"
      ? context.irreversibleAuthorizationEnabled
      : !currentMain || currentMain[IRREVERSIBLE_AUTH_SETTING] !== false;
    if (
      candidateMain && candidateMain[IRREVERSIBLE_AUTH_SETTING] === false &&
      currentlyEnabled
    ) {
      if (context.callerBuiltin !== true || context.callerAppId !== MAIN_APPLICATION_ID) {
        throw new TypeError("Protected settings can only be changed by the main application");
      }
      return createSettingDisablePrompt();
    }
    return null;
  }

  if (route === "/native/coins/activate" || route === "/native/coins/restart") {
    if (!startupRequestEnablesChainWriting(payload, context)) return null;
    if (
      gatedAuthorizationEnabled &&
      (context.callerBuiltin !== true || context.callerAppId !== MAIN_APPLICATION_ID)
    ) {
      throw new TypeError("Protected wallet actions are restricted to the main application");
    }
    const startupState = context.effectiveStartupSecurityState;
    const prompt = createPrompt(
      route,
      spec("Start a daemon with mining or staking enabled", [
        "chainTicker", "startupOptions", "launchConfig", "effectiveStartupSecurity",
      ]),
      startupState == null
        ? payload
        : {
            ...payload,
            effectiveStartupSecurity: {
              configurationPath: startupState.configurationPath,
              configurationState: startupState.configurationState,
              chainWriting: startupState.chainWriting,
              fingerprint: startupState.fingerprint,
            },
          },
      context,
      AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION,
      gatedAuthorizationEnabled
    );
    return Object.freeze({
      ...prompt,
      ...(startupState == null ? {} : { startupFingerprint: startupState.fingerprint }),
    });
  }

  const alwaysSpec = ALWAYS_AUTHORIZED_ROUTE_SPECS[route];
  if (alwaysSpec) {
    if (context.callerBuiltin !== true || context.callerAppId !== MAIN_APPLICATION_ID) {
      throw new TypeError("Protected wallet actions are restricted to the main application");
    }
    return createPrompt(
      route,
      alwaysSpec,
      payload,
      context,
      AUTHORIZATION_SCOPES.WALLET_AUTHORITY,
      true
    );
  }

  const irreversibleSpec = IRREVERSIBLE_ROUTE_SPECS[route];
  if (
    route === "/native/verusid/login/sign_response" &&
    context.callerAppId === LOGIN_CONSENT_APPLICATION_ID &&
    context.loginConsentSessionAvailable !== true
  ) {
    throw new TypeError("No matching focused login-consent request is pending");
  }
  if (
    irreversibleSpec &&
    (gatedAuthorizationEnabled || irreversibleSpec.alwaysRestrictCaller === true) &&
    !callerIsAllowed(irreversibleSpec, context)
  ) {
    throw new TypeError("Protected wallet actions are restricted to the main application");
  }
  return irreversibleSpec
    ? createPrompt(
      route,
      irreversibleSpec,
      payload,
      context,
      AUTHORIZATION_SCOPES.IRREVERSIBLE_ACTION,
      gatedAuthorizationEnabled
    )
    : null;
};

module.exports = {
  ALWAYS_AUTHORIZED_ROUTES: Object.freeze(Object.keys(ALWAYS_AUTHORIZED_ROUTE_SPECS)),
  IRREVERSIBLE_ACTION_ROUTES: Object.freeze(Object.keys(IRREVERSIBLE_ROUTE_SPECS)),
  IRREVERSIBLE_AUTH_SETTING,
  createApiAuthorizationRequest,
  formatActionDetails,
};
