const passwdStrength = require('passwd-strength');
const CryptoJS = require("crypto-js");
var blake2b = require('blake2b');
const { randomBytes, timingSafeEqual } = require('crypto');
const {
  createApiAuthorizationRequest,
} = require("./native/irreversibleActionPolicy");
const {
  createProtectedActionExecutionService,
} = require("./native/protectedActionExecution");

const TOKEN_WINDOW_MS = 10 * 60 * 1000;
const TOKEN_HEX_LENGTH = 128;
const DEFAULT_PROTECTED_ACTION_TIMEOUT_MS = 11 * 60 * 1000;

const decrypt = (data, key) => CryptoJS.AES.decrypt(data, key).toString(CryptoJS.enc.Utf8);
const encrypt = (data, key) => CryptoJS.AES.encrypt(data, key).toString()

module.exports = (api) => {
  api.seenTimes = new Map()
  api.protectedActionExecution = createProtectedActionExecutionService(api);
  api.getProtectedActionExecutionContext = () =>
    api.protectedActionExecution.currentExecutionContext();
  api.assertProtectedActionExecutionActive = () => {
    const context = api.getProtectedActionExecutionContext();
    if (context && typeof context.assertActive === "function") {
      context.assertActive();
    }
    return true;
  };

  api.permissionlessPaths = [
    'help',
    'request_credentials'
  ]

  api.checkToken = (validity_key, path, time, app_info) => {
    if (api.permissionlessPaths.includes(path)) return true;

    const { id, builtin } = app_info || {};
    const now = Date.now();

    if (builtin !== true || typeof api.BuiltinSecret !== "string" || !api.BuiltinSecret) {
      return false;
    }
    if (typeof id !== "string" || !id || typeof path !== "string" || !path) return false;
    if (!Number.isSafeInteger(time) || Math.abs(now - time) > TOKEN_WINDOW_MS) {
      throw new Error("Cannot make expired call.");
    }
    if (typeof validity_key !== "string" ||
        validity_key.length !== TOKEN_HEX_LENGTH ||
        !/^[0-9a-f]+$/i.test(validity_key)) {
      return false;
    }

    for (const [seenToken, seenAt] of api.seenTimes) {
      if (now - seenAt > TOKEN_WINDOW_MS) api.seenTimes.delete(seenToken);
    }

    const hash = blake2b(64);
    hash.update(Buffer.from(String(time)));
    hash.update(Buffer.from(api.BuiltinSecret));
    hash.update(Buffer.from(path));
    hash.update(Buffer.from(id));

    const expected = Buffer.from(hash.digest("hex"), "hex");
    const received = Buffer.from(validity_key, "hex");
    const valid = expected.length === received.length && timingSafeEqual(expected, received);

    if (valid) {
      const tokenKey = received.toString("hex");
      if (api.seenTimes.has(tokenKey)) throw new Error("Cannot repeat call");
      api.seenTimes.set(tokenKey, now);
    }
    return valid;
  };

  api.setPost = (url, handler, forceEncryption = false) => {
    api.rpcCalls.POST[url] = {
      type: 'POST',
      encryption_mandatory: forceEncryption,
      url
    }

    api.post(url, async (req, res, next) => {
      res.type('json')

      let executionLease = null;
      let responseCompleted = false;
      let executionTimeout = null;
      const responseLifecycleListeners = [];
      let resolveResponseCompletion;
      const responseCompletion = new Promise((resolve) => {
        resolveResponseCompletion = resolve;
      });
      const releaseExecutionLease = () => {
        if (executionLease != null) {
          executionLease.release();
          executionLease = null;
        }
      };
      const completeResponse = () => {
        if (responseCompleted) return;
        responseCompleted = true;
        if (executionTimeout != null) {
          clearTimeout(executionTimeout);
          executionTimeout = null;
        }
        for (const [event, listener] of responseLifecycleListeners) {
          if (typeof res.removeListener === "function") {
            res.removeListener(event, listener);
          }
        }
        releaseExecutionLease();
        resolveResponseCompletion();
      };
      if (typeof res.once === "function") {
        for (const event of ["finish", "close", "error"]) {
          const listener = () => completeResponse();
          res.once(event, listener);
          responseLifecycleListeners.push([event, listener]);
        }
      }
      const armExecutionTimeout = () => {
        const configuredTimeout = api.protectedActionResponseTimeoutMs;
        const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout > 0
          ? configuredTimeout
          : DEFAULT_PROTECTED_ACTION_TIMEOUT_MS;
        executionTimeout = setTimeout(() => {
          if (responseCompleted) return;
          try {
            if (!res.headersSent && res.destroyed !== true) {
              if (typeof res.status === "function") res.status(504);
              sendWrapped(JSON.stringify({
                msg: "error",
                result:
                  "The protected operation did not complete in time. Its authorization was revoked; verify wallet state before retrying.",
              }));
            } else {
              completeResponse();
            }
          } catch (error) {
            api.log(error, "setPost.timeout");
            completeResponse();
          }
        }, timeoutMs);
        if (executionTimeout && typeof executionTimeout.unref === "function") {
          executionTimeout.unref();
        }
      };

      if (api.appConfig.general.main.livelog) {
        api.writeLog(`POST, url: ${url}, forceEncryption: ${forceEncryption}`, 'api.http.request')
      }

      const requestEncrypted =
        req.body.encrypted === true || req.body.encrypted === "true";
      const builtin = req.body.builtin === 'true' || req.body.builtin === true;
      const shieldKey = builtin ? api.BuiltinSecret : null;
      const sendWrapped = (data) => {
        if (responseCompleted) return res;
        const encryptResponse =
          requestEncrypted &&
          typeof shieldKey === "string" &&
          shieldKey.length > 0;

        try {
          return res.send(
            JSON.stringify(
              encryptResponse
                ? { payload: encrypt(data, shieldKey) }
                : { payload: data }
            )
          );
        } finally {
          completeResponse();
        }
      };

      try {
        let payload = null
        
        try {
          if (
            !api.checkToken(
              req.body.validity_key,
              url.replace('/', ''),
              Number(req.body.time),
              { id: req.body.app_id, builtin }
            )
          ) 
            throw new Error("Incorrect API validity key");
        } catch(e) {
          res.status(401);
          throw e
        }

        if (forceEncryption && !requestEncrypted) {
          res.status(400);
          throw new Error("Encrypted API payload required");
        }
        
        if (!requestEncrypted) {
          payload = req.body.payload;
        } else {
          try {
            payload = JSON.parse(decrypt(req.body.payload, shieldKey));
          } catch (e) {
            res.status(400);
            throw new Error("Invalid encrypted API payload");
          }
        }

        let nativeAuthorizationContext = null;
        let startupSecurityState = null;
        if (url === "/native/coins/activate" || url === "/native/coins/restart") {
          if (
            api.native == null ||
            typeof api.native.captureStartupSecurityState !== "function"
          ) {
            throw new Error("Daemon startup authorization policy is unavailable");
          }
          startupSecurityState = url === "/native/coins/activate" &&
              typeof api.native.captureActivationSecurityState === "function"
            ? await api.native.captureActivationSecurityState(
                payload && payload.chainTicker,
                payload && payload.launchConfig,
                payload && payload.startupOptions
              )
            : api.native.captureStartupSecurityState(
                payload && payload.chainTicker,
                payload && payload.launchConfig,
                payload && payload.startupOptions
              );
        }
        if (responseCompleted) return;
        const authorizationRequest = createApiAuthorizationRequest(url, payload, {
          callerAppId: req.body.app_id,
          callerBuiltin: builtin,
          currentConfig: api.appConfig,
          irreversibleAuthorizationEnabled:
            typeof api.isIrreversibleAuthorizationEnabled === "function"
              ? api.isIrreversibleAuthorizationEnabled()
              : undefined,
          effectiveStartupSecurityState: startupSecurityState,
          loginConsentSessionAvailable:
            url === "/native/verusid/login/sign_response" &&
            req.body.app_id === "VERUS_LOGIN_CONSENT_UI" &&
            api.loginConsentUi != null &&
            typeof api.loginConsentUi.hasPendingResponse === "function"
              ? api.loginConsentUi.hasPendingResponse(payload && payload.response)
              : undefined,
        });
        if (authorizationRequest != null) {
          executionLease = api.protectedActionExecution.reserveProtected({
            route: url,
            payload,
            startupSecurityState,
          });
          if (
            api.nativeAuthorization == null ||
            typeof api.nativeAuthorization.authorize !== "function"
          ) {
            return sendWrapped(JSON.stringify({
              msg: "error",
              result: "Native authorization is unavailable; the protected operation was not executed.",
            }));
          }

          const authorization = await api.nativeAuthorization.authorize(authorizationRequest);
          if (responseCompleted) return;
          if (
            authorization == null ||
            (authorization.status !== "approved" && authorization.status !== "not-required")
          ) {
            const result = authorization && authorization.status === "cancelled"
              ? "Protected operation cancelled."
              : authorization && typeof authorization.message === "string"
                ? authorization.message
                : "Native authorization failed; the protected operation was not executed.";
            return sendWrapped(JSON.stringify({ msg: "error", result }));
          }
          const currentStartupSecurityState = startupSecurityState == null
            ? null
            : api.native.captureStartupSecurityState(
                payload.chainTicker,
                payload.launchConfig,
                payload.startupOptions
              );
          if (!executionLease.matches(currentStartupSecurityState)) {
            return sendWrapped(JSON.stringify({
              msg: "error",
              result: "The protected wallet target changed while awaiting authorization; the operation was not executed.",
            }));
          }
          nativeAuthorizationContext = Object.freeze({
            status: authorization.status,
            scope: authorizationRequest.scope,
            actionId: authorizationRequest.actionId,
            ...(typeof authorization.operationId === "string"
              ? { operationId: authorization.operationId }
              : {}),
            ...(typeof authorizationRequest.startupFingerprint === "string"
              ? { startupFingerprint: authorizationRequest.startupFingerprint }
              : {}),
          });
        } else {
          executionLease = api.protectedActionExecution.reserveMutation(url);
        }
        
        const wrappedSend = (data) => sendWrapped(data);
        let handlerResponse;
        handlerResponse = new Proxy(res, {
          get(target, property) {
            if (property === "send") return wrappedSend;
            const value = Reflect.get(target, property, target);
            if (typeof value !== "function") return value;

            return (...args) => {
              const result = Reflect.apply(value, target, args);
              // Preserve Express method chaining without allowing a chained
              // .send() to bypass response encryption.
              return result === target ? handlerResponse : result;
            };
          },
          set(target, property, value) {
            return Reflect.set(target, property, value, target);
          },
        });

        const invokeHandler = () => handler(
          {
            ...req,
            body: payload,
            api_header: { app_id: req.body.app_id, builtin },
            native_authorization: nativeAuthorizationContext,
          },
          handlerResponse,
          next
        );
        if (
          executionLease != null &&
          authorizationRequest != null &&
          typeof executionLease.run === "function"
        ) {
          armExecutionTimeout();
          await executionLease.run(nativeAuthorizationContext, invokeHandler);
        } else {
          if (executionLease != null) armExecutionTimeout();
          await invokeHandler();
        }
        // A number of legacy routes start a promise/callback chain without
        // returning it. Keep the target lease through the actual response so a
        // competing logout/activation cannot swap the approved target midway.
        if (executionLease != null && !responseCompleted) await responseCompletion;
      } catch(e) {  
        api.log('HTTP POST error', 'setPost')
        api.log(e, 'setPost')

        if (res.headersSent) {
          completeResponse();
          return;
        }
        return sendWrapped(JSON.stringify({
          msg: "error",
          result: e.message,
        }));
      } finally {
        if (responseCompleted) releaseExecutionLease();
      }
    })
  }

  api.setGet = (url, handler) => {
    api.rpcCalls.GET[url] = {
      type: 'GET',
      url
    }

    api.get(url, async (req, res, next) => {
      res.type('json')

      try {  
        try {
          if (
            !api.checkToken(
              req.query.validity_key,
              url.replace('/', ''),
              Number(req.query.time),
              { id: req.query.app_id, builtin: req.query.builtin === 'true' || req.query.builtin === true }
            )
          )
            throw new Error("Incorrect API validity key");
        } catch(e) {
          res.status(401);
          throw e
        }
        
        if (api.appConfig.general.main.livelog) {
          let req_id = randomBytes(8).toString('hex')
          
          handler(req, {
            send: (jsonString) => {
              api.writeLog(
                JSON.stringify(JSON.parse(jsonString), null, 2),
                `api.http.response ${req_id}`
              );
            }
          }, next)
          
          api.writeLog(`GET, url: ${url}`, `api.http.request ${req_id}`)
        }
        
        handler(req, res, next)
      } catch(e) {  
        api.log('HTTP GET error', 'setGet')
        api.log(e, 'setGet')

        res.send(JSON.stringify({
          payload: JSON.stringify({
            msg: "error",
            result: e.message,
          }),
        }));
      }
    })
  }

  api.checkStringEntropy = (str) => {
    // https://tools.ietf.org/html/rfc4086#page-35
    return passwdStrength(str) < 29 ? false : true;
  };

  api.isWatchOnly = () => {
    return api.argv && api.argv.watchonly === 'override' ? false : api._isWatchOnly;
  };

  api.setGet('/help', (req, res, next) => {
    const retObj = {
      msg: 'success',
      result: {
        devmode: api.isDevMode === true,
        rpc_api: api.rpcCalls
      },
    };

    res.send(JSON.stringify(retObj));
  });

  return api;
};
