const { isAllowedRpcMethod, isValidChainTicker } = require("./security");

const RPC_METHOD = /^[a-z][a-z0-9_]{0,127}$/;
const MAX_PARAMS_BYTES = 64 * 1024;
const MAX_PARAM_DEPTH = 32;
const MAX_PARAM_NODES = 20000;

// These methods return private authority or directly decrypted plaintext in
// the JSON-RPC response. Their response must be persisted by the main process
// and must never cross the HTTP boundary back into the renderer.
const SENSITIVE_RESULT_RPC_METHODS = new Set([
  "convertpassphrase",
  "decryptdata",
  "dumpprivkey",
  "registernamecommitment",
  "signdata",
  "z_exportkey",
  "z_exportviewingkey",
  "z_getencryptionaddress",
  "z_getpaymentdisclosure",
  "z_listreceivedbyaddress",
  "z_listunspent",
  "z_validatepaymentdisclosure",
  "z_viewtransaction",
  "zcrawkeygen",
  "zcrawreceive",
]);

// Methods audited against the daemon bundled with Desktop whose result may be
// shown after approval. A syntactically valid method absent from this set is
// still executable, but its result is conservatively handled as sensitive.
const APPROVED_INLINE_PRIVILEGED_RPC_METHODS = new Set([
  "addmergedblock",
  "addmultisigaddress",
  "addnode",
  "backupwallet",
  "clearbanned",
  "clearrawmempool",
  "closeoffers",
  "createrawtransaction",
  "definecurrency",
  "disconnectnode",
  "dumpwallet",
  "encryptwallet",
  "fundrawtransaction",
  "generate",
  "generateadjustmentreport",
  "getaccountaddress",
  "getnewaddress",
  "getrawchangeaddress",
  "importaddress",
  "importprivkey",
  "importwallet",
  "invalidateblock",
  "jumblr_deposit",
  "jumblr_pause",
  "jumblr_resume",
  "jumblr_secret",
  "keypoolrefill",
  "lockunspent",
  "makeoffer",
  "move",
  "openwallet",
  "prioritisetransaction",
  "processupgradedata",
  "prunespentwallettransactions",
  "reconsiderblock",
  "recoveridentity",
  "refundfailedlaunch",
  "registeridentity",
  "rescanfromheight",
  "resendwallettransactions",
  "revokeidentity",
  "sendcurrency",
  "sendfrom",
  "sendmany",
  "sendrawtransaction",
  "sendtoaddress",
  "setaccount",
  "setban",
  "setcurrencytrust",
  "setgenerate",
  "setidentitytimelock",
  "setidentitytrust",
  "setminingdistribution",
  "setmocktime",
  "settxfee",
  "signfile",
  "signmessage",
  "signrawtransaction",
  "stop",
  "submitchallenges",
  "submitacceptednotarization",
  "submitblock",
  "submitimports",
  "submitmergedblock",
  "takeoffer",
  "updateidentity",
  "walletlock",
  "walletpassphrase",
  "walletpassphrasechange",
  "z_exportwallet",
  "z_getnewaddress",
  "z_getoperationresult",
  "z_importkey",
  "z_importviewingkey",
  "z_importwallet",
  "z_mergetoaddress",
  "z_sendmany",
  "z_setmigration",
  "z_shieldcoinbase",
  "zcbenchmark",
  "zcrawjoinsplit",
  "zcsamplejoinsplit",
]);

const FUND_OR_SIGN_RPC_METHODS = new Set([
  "closeoffers",
  "definecurrency",
  "encryptdata",
  "fundrawtransaction",
  "generate",
  "generateadjustmentreport",
  "jumblr_deposit",
  "jumblr_resume",
  "jumblr_secret",
  "makeoffer",
  "recoveridentity",
  "refundfailedlaunch",
  "registeridentity",
  "registernamecommitment",
  "resendwallettransactions",
  "revokeidentity",
  "sendcurrency",
  "sendfrom",
  "sendmany",
  "sendrawtransaction",
  "sendtoaddress",
  "setidentitytimelock",
  "setminingdistribution",
  "signdata",
  "signfile",
  "signmessage",
  "signrawtransaction",
  "submitchallenges",
  "submitacceptednotarization",
  "submitimports",
  "takeoffer",
  "updateidentity",
  "z_getpaymentdisclosure",
  "z_mergetoaddress",
  "z_sendmany",
  "z_setmigration",
  "z_shieldcoinbase",
  "zcbenchmark",
  "zcrawjoinsplit",
]);

const WALLET_AUTHORITY_RPC_METHODS = new Set([
  "backupwallet",
  "convertpassphrase",
  "dumpprivkey",
  "dumpwallet",
  "encryptwallet",
  "importprivkey",
  "importwallet",
  "openwallet",
  "walletpassphrase",
  "walletpassphrasechange",
  "z_exportkey",
  "z_exportviewingkey",
  "z_exportwallet",
  "z_getencryptionaddress",
  "z_importkey",
  "z_importviewingkey",
  "z_importwallet",
  "zcrawkeygen",
]);

const SENSITIVE_FILE_SIDE_EFFECT_RPC_METHODS = new Set([
  "backupwallet",
  "dumpwallet",
  "z_exportwallet",
]);

const SECRET_PARAMETER_INDEXES = new Map([
  ["addmergedblock", new Set([4])],
  ["convertpassphrase", new Set([0])],
  ["createwallet", new Set([4])],
  ["decryptdata", new Set([])],
  ["deriveaddresses", new Set([0])],
  ["encryptdata", new Set([1, 2, 3])],
  ["encryptwallet", new Set([0])],
  ["importprivkey", new Set([0])],
  ["importdescriptors", new Set([0])],
  ["importmulti", new Set([0])],
  ["openwallet", new Set([0])],
  ["sethdseed", new Set([1])],
  ["signmessagewithprivkey", new Set([0])],
  ["signrawtransaction", new Set([2])],
  ["signrawtransactionwithkey", new Set([1])],
  ["walletpassphrase", new Set([0])],
  ["walletpassphrasechange", new Set([0, 1])],
  ["z_importkey", new Set([0])],
  ["z_importviewingkey", new Set([0])],
  ["z_validatepaymentdisclosure", new Set([0])],
  ["zcrawjoinsplit", new Set([1])],
  ["zcrawreceive", new Set([0])],
]);

const SECRET_PROPERTY = /(?:pass(?:word|phrase)?|private|privkey|secret|spending|viewing|walletseed|mnemonic|rootkey|wif|xprv|api.?key|auth.?key|(?:^|_)(?:salt|seed|evk|ivk|ssk)(?:$|_))/i;
const FUTURE_SENSITIVE_RESULT_METHOD = /(?:decrypt|paymentdisclosure|rawkeygen|rawreceive)|^(?:convert|dump|export|get|reveal|z_export|z_get).*(?:passphrase|priv(?:ate)?key|secretkey|spendingkey|viewingkey|walletseed|mnemonic|seed)$/i;
const REDACTED_VALUE = "[REDACTED: secret parameter]";

const isValidRpcMethod = (method) =>
  typeof method === "string" && RPC_METHOD.test(method);

const validateJsonValue = (value, state, depth) => {
  if (depth > MAX_PARAM_DEPTH) throw new Error("Daemon RPC parameters are nested too deeply");
  state.nodes += 1;
  if (state.nodes > MAX_PARAM_NODES) throw new Error("Daemon RPC parameters are too complex");

  if (value == null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Daemon RPC parameters must contain finite numbers");
    return;
  }
  if (typeof value !== "object") throw new Error("Daemon RPC parameters must be JSON values");

  if (Array.isArray(value)) {
    for (const child of value) validateJsonValue(child, state, depth + 1);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Daemon RPC parameters must contain plain JSON objects");
  }
  for (const key of Object.keys(value)) {
    validateJsonValue(value[key], state, depth + 1);
  }
};

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const classifyTerminalRpcMethod = (method) => {
  if (!isValidRpcMethod(method)) throw new Error("Invalid daemon RPC method");

  const auditedSensitiveResult = SENSITIVE_RESULT_RPC_METHODS.has(method);
  if (auditedSensitiveResult || FUTURE_SENSITIVE_RESULT_METHOD.test(method)) {
    return Object.freeze({
      kind: "sensitive-output",
      highRisk:
        !auditedSensitiveResult ||
        FUND_OR_SIGN_RPC_METHODS.has(method) ||
        WALLET_AUTHORITY_RPC_METHODS.has(method),
    });
  }
  if (isAllowedRpcMethod(method)) {
    return Object.freeze({ kind: "read-only", highRisk: false });
  }

  // Unknown methods fail closed on output: the command remains available after
  // confirmation, but the response is saved instead of entering the renderer.
  const knownInline = APPROVED_INLINE_PRIVILEGED_RPC_METHODS.has(method);
  return Object.freeze({
    kind: knownInline ? "privileged" : "sensitive-output",
    highRisk:
      !knownInline ||
      FUND_OR_SIGN_RPC_METHODS.has(method) ||
      WALLET_AUTHORITY_RPC_METHODS.has(method),
    ...(SENSITIVE_FILE_SIDE_EFFECT_RPC_METHODS.has(method)
      ? { sensitiveFileSideEffect: true }
      : {}),
  });
};

const createTerminalRpcRequest = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid daemon RPC request");
  }

  const chainTicker = body.chainTicker;
  const method = body.cmd;
  const params = body.params;
  if (!isValidChainTicker(chainTicker) || !isValidRpcMethod(method) || !Array.isArray(params)) {
    throw new Error("Invalid chain or daemon RPC request");
  }

  validateJsonValue(params, { nodes: 0 }, 0);
  const serialized = JSON.stringify(params);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PARAMS_BYTES) {
    throw new Error("Daemon RPC parameters are too large to confirm safely");
  }

  const clonedParams = JSON.parse(serialized);
  const request = {
    chainTicker,
    method,
    params: clonedParams,
    policy: classifyTerminalRpcMethod(method),
  };
  return deepFreeze(request);
};

const redactSecretProperties = (value) => {
  if (Array.isArray(value)) return value.map(redactSecretProperties);
  if (!value || typeof value !== "object") return value;

  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(redacted, key, {
      configurable: true,
      enumerable: true,
      value: SECRET_PROPERTY.test(key) ? REDACTED_VALUE : redactSecretProperties(child),
      writable: true,
    });
  }
  return redacted;
};

const redactTerminalRpcParams = (request) => {
  const indexes = SECRET_PARAMETER_INDEXES.get(request.method) || new Set();
  return request.params.map((value, index) =>
    indexes.has(index) ? REDACTED_VALUE : redactSecretProperties(value)
  );
};

const escapeInvisibleCharacters = (value) => value.replace(
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g,
  (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
);

const escapeDisplayValue = (value) => {
  if (typeof value === "string") return escapeInvisibleCharacters(value);
  if (Array.isArray(value)) return value.map(escapeDisplayValue);
  if (!value || typeof value !== "object") return value;

  const escaped = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(escaped, escapeInvisibleCharacters(key), {
      configurable: true,
      enumerable: true,
      value: escapeDisplayValue(child),
      writable: true,
    });
  }
  return escaped;
};

const formatTerminalRpcRequest = (request) => JSON.stringify({
  chain: escapeInvisibleCharacters(request.chainTicker),
  method: escapeInvisibleCharacters(request.method),
  params: escapeDisplayValue(redactTerminalRpcParams(request)),
}, null, 2);

module.exports = {
  APPROVED_INLINE_PRIVILEGED_RPC_METHODS,
  FUND_OR_SIGN_RPC_METHODS,
  MAX_PARAMS_BYTES,
  REDACTED_VALUE,
  SENSITIVE_RESULT_RPC_METHODS,
  SENSITIVE_FILE_SIDE_EFFECT_RPC_METHODS,
  WALLET_AUTHORITY_RPC_METHODS,
  classifyTerminalRpcMethod,
  createTerminalRpcRequest,
  escapeInvisibleCharacters,
  formatTerminalRpcRequest,
  isValidRpcMethod,
  redactTerminalRpcParams,
};
