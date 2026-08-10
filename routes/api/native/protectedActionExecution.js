"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const { createHash } = require("crypto");
const { normalizeRpcPort } = require("../utils/rpcPort");

const TARGET_MUTATION_ROUTES = new Set([
  "/config/reset",
  "/config/save",
  "/electrum/auth",
  "/electrum/coins/activate",
  "/electrum/lock",
  "/electrum/logout",
  "/electrum/remove_coin",
  "/erc20/auth",
  "/erc20/coins/activate",
  "/erc20/logout",
  "/erc20/remove_coin",
  "/eth/auth",
  "/eth/coins/activate",
  "/eth/logout",
  "/eth/remove_coin",
  "/native/coins/activate",
  "/native/coins/restart",
  "/native/remove_coin",
]);

const STARTUP_ROUTES = new Set([
  "/native/coins/activate",
  "/native/coins/restart",
]);

const NON_RPC_NATIVE_ROUTES = new Set([
  "/native/bridgekeeper_setconf",
  "/native/start_bridgekeeper",
]);

const normalizeTicker = (value) =>
  typeof value === "string" && /^[0-9a-z._-]{1,64}$/i.test(value)
    ? value
    : null;

const nativeChainFromPayload = (route, payload) => {
  if (route === "/native/verusid/login/sign_response") {
    return normalizeTicker(payload && payload.response && payload.response.chainTicker);
  }
  return normalizeTicker(payload && (
    payload.chainTicker || payload.chain || payload.coin
  ));
};

const createProtectedActionExecutionService = (api) => {
  // Express routers are callable functions with state attached to them. The
  // application API is therefore a function in production, while unit-test
  // fixtures commonly model it as a plain object.
  if (
    api == null ||
    (typeof api !== "object" && typeof api !== "function")
  ) {
    throw new TypeError("API state is required");
  }

  const storage = new AsyncLocalStorage();
  const referenceIds = new WeakMap();
  let nextReferenceId = 1;
  let protectedLeaseActive = false;
  let mutationLeaseCount = 0;

  const referenceId = (value) => {
    if (value == null || (typeof value !== "object" && typeof value !== "function")) {
      return `primitive:${String(value)}`;
    }
    if (!referenceIds.has(value)) referenceIds.set(value, nextReferenceId++);
    return `reference:${referenceIds.get(value)}`;
  };

  const hashValues = (values) => {
    const hash = createHash("sha256");
    for (const value of values) {
      hash.update(value == null ? "[absent]" : String(value));
      hash.update("\0");
    }
    return hash.digest("hex");
  };

  const captureNativeRpcTarget = (chain) => {
    if (!api.rpcConf[chain] && typeof api.getConf === "function") api.getConf(chain);
    const rpcConfig = api.rpcConf[chain];
    const port = rpcConfig == null ? null : normalizeRpcPort(rpcConfig.port);
    if (
      rpcConfig == null ||
      port == null ||
      typeof rpcConfig.user !== "string" ||
      typeof rpcConfig.pass !== "string"
    ) {
      throw new Error("The approved daemon RPC target is unavailable");
    }
    return Object.freeze({
      chain,
      port,
      user: rpcConfig.user,
      pass: rpcConfig.pass,
    });
  };

  const captureTarget = (route, payload, startupSecurityState) => {
    if (STARTUP_ROUTES.has(route)) {
      if (
        startupSecurityState == null ||
        typeof startupSecurityState.fingerprint !== "string"
      ) {
        throw new Error("Unable to bind the daemon startup request");
      }
      return Object.freeze({
        fingerprint: hashValues(["startup", route, startupSecurityState.fingerprint]),
        startupFingerprint: startupSecurityState.fingerprint,
      });
    }

    if (route === "/config/save") {
      return Object.freeze({
        fingerprint: hashValues([
          "config",
          api.appConfig && api.appConfig.general && api.appConfig.general.main &&
            api.appConfig.general.main.requireNativeAuthForIrreversibleActions,
        ]),
      });
    }

    if (route === "/eth/sendtx") {
      const wallet = api.eth && api.eth.wallet;
      const providerInterface = api.eth && api.eth.interface;
      if (!wallet || !providerInterface) throw new Error("The Ethereum wallet target is unavailable");
      return Object.freeze({
        fingerprint: hashValues([
          "eth", referenceId(wallet), referenceId(providerInterface), wallet.address,
          providerInterface.network && providerInterface.network.id,
          referenceId(providerInterface.InfuraProvider),
          referenceId(providerInterface.DefaultProvider),
        ]),
      });
    }

    if (route === "/erc20/sendtx") {
      const contractId = normalizeTicker(payload && payload.chainTicker);
      const wallet = api.erc20 && api.erc20.wallet;
      const contractTarget = contractId && api.erc20 && api.erc20.contracts[contractId];
      if (!contractId || !wallet || !contractTarget) {
        throw new Error("The ERC-20 wallet target is unavailable");
      }
      return Object.freeze({
        fingerprint: hashValues([
          "erc20", contractId, referenceId(wallet), wallet.address,
          referenceId(contractTarget), referenceId(contractTarget.interface),
          referenceId(contractTarget.contract), contractTarget.decimals, contractTarget.symbol,
        ]),
      });
    }

    if (route === "/electrum/sendtx") {
      const chain = normalizeTicker(payload && payload.chainTicker);
      const coinKey = chain && chain.toLowerCase();
      const coinData = coinKey && api.electrum && api.electrum.coinData[coinKey];
      const walletKey = coinKey && api.electrumKeys && api.electrumKeys[coinKey];
      const serverConfig = coinKey && api.electrumServers && api.electrumServers[coinKey];
      if (!coinKey || !coinData || (!walletKey && !payload.customWif)) {
        throw new Error("The Lite-wallet target is unavailable");
      }
      return Object.freeze({
        fingerprint: hashValues([
          "electrum", coinKey, referenceId(coinData), referenceId(walletKey),
          walletKey && walletKey.pub, walletKey && walletKey.priv,
          referenceId(serverConfig),
          coinData.server && coinData.server.ip,
          coinData.server && coinData.server.port,
          coinData.server && coinData.server.proto,
          serverConfig && serverConfig.txfee,
          payload.customWif,
        ]),
      });
    }

    if (route.startsWith("/native/")) {
      const chain = nativeChainFromPayload(route, payload);
      if (!chain) throw new Error("The native wallet chain target is unavailable");
      if (NON_RPC_NATIVE_ROUTES.has(route)) {
        const rpcConfig = api.rpcConf[chain];
        return Object.freeze({
          fingerprint: hashValues([
            "native-service", chain, referenceId(rpcConfig),
            api.confFileIndex && api.confFileIndex[chain],
          ]),
        });
      }
      const rpcTarget = captureNativeRpcTarget(chain);
      return Object.freeze({
        fingerprint: hashValues([
          "native-rpc", chain, api.confFileIndex && api.confFileIndex[chain],
          rpcTarget.port, rpcTarget.user, rpcTarget.pass,
          referenceId(api.rpcConf[chain]),
        ]),
        nativeRpcTarget: rpcTarget,
      });
    }

    return Object.freeze({ fingerprint: hashValues(["request", route]) });
  };

  const reserveProtected = ({ route, payload, startupSecurityState = null }) => {
    if (protectedLeaseActive || mutationLeaseCount > 0) {
      throw new Error("Wallet target state is changing or another protected action is active");
    }
    const target = captureTarget(route, payload, startupSecurityState);
    protectedLeaseActive = true;
    let released = false;
    const executionContext = (authorization) => Object.freeze({
      authorization,
      route,
      target,
      isActive: () => !released,
      assertActive() {
        if (released) {
          throw new Error(
            "The protected action request ended before execution completed"
          );
        }
        return true;
      },
    });

    return Object.freeze({
      target,
      matches(currentStartupSecurityState = startupSecurityState) {
        if (released) return false;
        try {
          return captureTarget(route, payload, currentStartupSecurityState).fingerprint ===
            target.fingerprint;
        } catch (error) {
          return false;
        }
      },
      run(authorization, callback) {
        if (released || typeof callback !== "function") {
          throw new Error("Protected action lease is unavailable");
        }
        return storage.run(executionContext(authorization), callback);
      },
      release() {
        if (released) return;
        released = true;
        protectedLeaseActive = false;
      },
    });
  };

  const reserveMutation = (route) => {
    if (!TARGET_MUTATION_ROUTES.has(route)) return null;
    if (protectedLeaseActive) {
      throw new Error("A protected wallet action is active; wallet target state was not changed");
    }
    mutationLeaseCount += 1;
    let released = false;
    return Object.freeze({
      release() {
        if (released) return;
        released = true;
        mutationLeaseCount -= 1;
      },
    });
  };

  return Object.freeze({
    currentExecutionContext: () => storage.getStore() || null,
    isMutationRoute: (route) => TARGET_MUTATION_ROUTES.has(route),
    reserveMutation,
    reserveProtected,
  });
};

module.exports = {
  TARGET_MUTATION_ROUTES: Object.freeze([...TARGET_MUTATION_ROUTES]),
  createProtectedActionExecutionService,
  nativeChainFromPayload,
};
