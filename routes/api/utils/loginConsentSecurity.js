const dns = require("dns");
const https = require("https");
const net = require("net");
const { URL } = require("url");

const CALLBACK_TIMEOUT_MS = 5_000;
const CALLBACK_MAX_BYTES = 1024 * 1024;

const LOCAL_HOSTNAME_SUFFIXES = [
  ".internal",
  ".lan",
  ".local",
  ".localdomain",
  ".localhost",
  ".home.arpa",
];

const normalizeHostname = (hostname) => {
  const unbracketed = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  return unbracketed.toLowerCase().replace(/\.$/, "");
};

const isPublicIpv4 = (address) => {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;

  return true;
};

const parseIpv6 = (address) => {
  const withoutZone = address.split("%")[0].toLowerCase();
  if (withoutZone.split("::").length > 2) return null;

  const convertEmbeddedIpv4 = (part) => {
    if (!part.includes(".")) return [part];
    if (!net.isIPv4(part)) return null;

    const octets = part.split(".").map(Number);
    return [
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    ];
  };

  const [leftRaw, rightRaw] = withoutZone.split("::");
  const expandSide = (side) => {
    if (!side) return [];
    const parts = side.split(":");
    const last = convertEmbeddedIpv4(parts[parts.length - 1]);
    if (last == null) return null;
    if (last.length === 2) parts.splice(parts.length - 1, 1, ...last);
    return parts;
  };

  const left = expandSide(leftRaw);
  const right = expandSide(rightRaw);
  if (left == null || right == null) return null;

  const missing = 8 - left.length - right.length;
  if ((withoutZone.includes("::") && missing < 1) || (!withoutZone.includes("::") && missing !== 0)) {
    return null;
  }

  const words = [
    ...left,
    ...Array(missing).fill("0"),
    ...right,
  ];

  if (
    words.length !== 8 ||
    words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))
  ) {
    return null;
  }

  return words.map((word) => Number.parseInt(word, 16));
};

const isPublicIpv6 = (address) => {
  const words = parseIpv6(address);
  if (words == null) return false;

  // Only globally routable IPv6 unicast addresses are valid callback targets.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return false;

  // Documentation, benchmarking, ORCHID, Teredo and 6to4 ranges are not
  // suitable public service destinations.
  if (words[0] === 0x2001 && words[1] === 0x0000) return false;
  if (words[0] === 0x2001 && words[1] === 0x0002) return false;
  if (words[0] === 0x2001 && words[1] >= 0x0010 && words[1] <= 0x002f) return false;
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false;
  if (words[0] === 0x2002) return false;

  return true;
};

const isPublicIpAddress = (address) => {
  const normalizedAddress = normalizeHostname(address);
  const family = net.isIP(normalizedAddress);

  if (family === 4) return isPublicIpv4(normalizedAddress);
  if (family === 6) return isPublicIpv6(normalizedAddress);
  return false;
};

const isLocalHostname = (hostname) => {
  if (!hostname || hostname.length > 253) return true;
  if (!hostname.includes(".")) return true;
  if (hostname === "localhost") return true;

  return LOCAL_HOSTNAME_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix)
  );
};

const parsePublicHttpsUrl = (uri) => {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > 2048) {
    throw new Error("Login consent callback URI must be a non-empty string of at most 2048 characters");
  }

  let url;
  try {
    url = new URL(uri);
  } catch (_) {
    throw new Error("Login consent callback URI is invalid");
  }

  if (url.protocol !== "https:") {
    throw new Error("Login consent callback URI must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Login consent callback URI must not contain credentials");
  }

  const hostname = normalizeHostname(url.hostname);
  const ipFamily = net.isIP(hostname);
  if (!ipFamily && isLocalHostname(hostname)) {
    throw new Error("Login consent callback URI must use a public hostname");
  }
  if (ipFamily && !isPublicIpAddress(hostname)) {
    throw new Error("Login consent callback URI must not target a private or special-use address");
  }

  return { url, hostname };
};

const isLoopbackHostname = (hostname) => {
  const normalizedHostname = normalizeHostname(hostname);
  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost")
  ) {
    return true;
  }

  if (net.isIPv4(normalizedHostname)) {
    return Number(normalizedHostname.split(".")[0]) === 127;
  }

  const words = net.isIPv6(normalizedHostname)
    ? parseIpv6(normalizedHostname)
    : null;
  if (words == null) return false;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;

  return (
    words.slice(0, 5).every((word) => word === 0) &&
    words[5] === 0xffff &&
    (words[6] >> 8) === 127
  );
};

const parseBrowserRedirectUrl = (uri) => {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > 2048) {
    throw new Error("Login consent redirect URI must be a non-empty string of at most 2048 characters");
  }

  let url;
  try {
    url = new URL(uri);
  } catch (_) {
    throw new Error("Login consent redirect URI is invalid");
  }

  if (url.username || url.password) {
    throw new Error("Login consent redirect URI must not contain credentials");
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return url;

  throw new Error("Login consent browser redirects must use HTTPS, except for loopback callbacks");
};

const normalizeLookupResults = (results) => {
  const entries = Array.isArray(results) ? results : [results];
  const normalized = entries.map((entry) => {
    if (typeof entry === "string") {
      return { address: entry, family: net.isIP(entry) };
    }

    const address = entry && entry.address;
    const actualFamily = typeof address === "string" ? net.isIP(address) : 0;
    const declaredFamily = entry && Number(entry.family);

    return {
      address,
      family: declaredFamily || actualFamily,
      familyMatches: !declaredFamily || declaredFamily === actualFamily,
    };
  });

  if (
    normalized.length === 0 ||
    normalized.some(
      ({ address, family, familyMatches }) =>
        typeof address !== "string" ||
        ![4, 6].includes(family) ||
        familyMatches === false ||
        !isPublicIpAddress(address)
    )
  ) {
    throw new Error("Login consent callback hostname did not resolve exclusively to public addresses");
  }

  return normalized.map(({ address, family }) => ({ address, family }));
};

const resolveWithTimeout = (operation, timeoutMs) => new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Login consent callback DNS lookup timed out")),
    timeoutMs
  );

  Promise.resolve(operation).then(
    (result) => {
      clearTimeout(timer);
      resolve(result);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    }
  );
});

const resolvePublicHttpsUrl = async (
  uri,
  lookup = dns.promises.lookup,
  timeoutMs = CALLBACK_TIMEOUT_MS
) => {
  const { url, hostname } = parsePublicHttpsUrl(uri);
  let results;

  try {
    results = await resolveWithTimeout(
      lookup(hostname, { all: true, verbatim: true }),
      timeoutMs
    );
  } catch (_) {
    throw new Error("Login consent callback hostname could not be resolved securely");
  }

  return {
    url,
    hostname,
    addresses: normalizeLookupResults(results),
  };
};

const createPinnedLookup = (expectedHostname, addresses) => {
  const normalizedExpectedHostname = normalizeHostname(expectedHostname);

  return (hostname, options, callback) => {
    const normalizedOptions = typeof options === "object" && options != null ? options : {};
    const done = typeof options === "function" ? options : callback;

    if (normalizeHostname(hostname) !== normalizedExpectedHostname) {
      done(new Error("Login consent callback attempted an unexpected DNS lookup"));
      return;
    }

    const requestedFamily = Number(normalizedOptions.family) || 0;
    const candidates = requestedFamily
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;

    if (candidates.length === 0) {
      done(new Error("Login consent callback has no address for the requested IP family"));
      return;
    }

    if (normalizedOptions.all) {
      done(null, candidates.map(({ address, family }) => ({ address, family })));
    } else {
      done(null, candidates[0].address, candidates[0].family);
    }
  };
};

const createWebhookRequestConfig = async (uri, options = {}) => {
  const resolved = await resolvePublicHttpsUrl(
    uri,
    options.lookup,
    options.dnsTimeout || options.timeout || CALLBACK_TIMEOUT_MS
  );
  const pinnedLookup = createPinnedLookup(resolved.hostname, resolved.addresses);

  return {
    url: resolved.url.toString(),
    config: {
      timeout: options.timeout || CALLBACK_TIMEOUT_MS,
      maxRedirects: 0,
      maxBodyLength: options.maxBytes || CALLBACK_MAX_BYTES,
      maxContentLength: options.maxBytes || CALLBACK_MAX_BYTES,
      proxy: false,
      responseType: "text",
      httpsAgent: new https.Agent({
        keepAlive: false,
        lookup: pinnedLookup,
        rejectUnauthorized: true,
      }),
    },
  };
};

const postWebhookWithDeadline = async (
  httpClient,
  url,
  body,
  config,
  deadlineMs = CALLBACK_TIMEOUT_MS
) => {
  let cancelRequest;
  let requestConfig = { ...config };

  if (typeof AbortController === "function") {
    const controller = new AbortController();
    requestConfig.signal = controller.signal;
    cancelRequest = () => controller.abort();
  } else if (
    httpClient &&
    httpClient.CancelToken &&
    typeof httpClient.CancelToken.source === "function"
  ) {
    const cancellation = httpClient.CancelToken.source();
    requestConfig.cancelToken = cancellation.token;
    cancelRequest = () => cancellation.cancel("Login consent callback deadline exceeded");
  } else {
    throw new Error("HTTP client does not support cancellable login consent callbacks");
  }

  const deadline = setTimeout(cancelRequest, deadlineMs);

  try {
    return await httpClient.post(url, body, requestConfig);
  } finally {
    clearTimeout(deadline);
  }
};

const getWebhookWithDeadline = async (
  httpClient,
  url,
  config,
  deadlineMs = CALLBACK_TIMEOUT_MS
) => {
  let cancelRequest;
  let requestConfig = { ...config };

  if (typeof AbortController === "function") {
    const controller = new AbortController();
    requestConfig.signal = controller.signal;
    cancelRequest = () => controller.abort();
  } else if (
    httpClient &&
    httpClient.CancelToken &&
    typeof httpClient.CancelToken.source === "function"
  ) {
    const cancellation = httpClient.CancelToken.source();
    requestConfig.cancelToken = cancellation.token;
    cancelRequest = () => cancellation.cancel("Login consent callback deadline exceeded");
  } else {
    throw new Error("HTTP client does not support cancellable login consent callbacks");
  }

  const deadline = setTimeout(cancelRequest, deadlineMs);

  try {
    return await httpClient.get(url, requestConfig);
  } finally {
    clearTimeout(deadline);
  }
};

const snapshotRequestRedirects = (request) => {
  const redirects = request && request.challenge && request.challenge.redirect_uris;
  if (redirects == null) return Object.freeze([]);
  if (!Array.isArray(redirects)) {
    throw new Error("Login consent request redirect list is invalid");
  }

  return Object.freeze(redirects.map((redirect) => {
    if (
      redirect == null ||
      typeof redirect.uri !== "string" ||
      typeof redirect.vdxfkey !== "string"
    ) {
      throw new Error("Login consent request contains an invalid redirect");
    }

    return Object.freeze({ uri: redirect.uri, vdxfkey: redirect.vdxfkey });
  }));
};

const bindRedirectToRequest = (selectedRedirect, requestRedirects) => {
  if (
    selectedRedirect == null ||
    typeof selectedRedirect.uri !== "string" ||
    typeof selectedRedirect.vdxfkey !== "string"
  ) {
    throw new Error("Login consent redirect selection is invalid");
  }

  const match = requestRedirects.find(
    ({ uri, vdxfkey }) =>
      uri === selectedRedirect.uri && vdxfkey === selectedRedirect.vdxfkey
  );

  if (match == null) {
    throw new Error("Login consent redirect was not present in the original request");
  }

  return match;
};

module.exports = {
  CALLBACK_MAX_BYTES,
  CALLBACK_TIMEOUT_MS,
  bindRedirectToRequest,
  createPinnedLookup,
  createWebhookRequestConfig,
  getWebhookWithDeadline,
  isLocalHostname,
  isLoopbackHostname,
  isPublicIpAddress,
  parseBrowserRedirectUrl,
  parsePublicHttpsUrl,
  postWebhookWithDeadline,
  resolvePublicHttpsUrl,
  snapshotRequestRedirects,
};
