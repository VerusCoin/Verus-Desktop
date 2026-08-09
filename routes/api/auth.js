const passwdStrength = require('passwd-strength');
const CryptoJS = require("crypto-js");
var blake2b = require('blake2b');
const { randomBytes, timingSafeEqual } = require('crypto');

const TOKEN_WINDOW_MS = 10 * 60 * 1000;
const TOKEN_HEX_LENGTH = 128;

const decrypt = (data, key) => CryptoJS.AES.decrypt(data, key).toString(CryptoJS.enc.Utf8);
const encrypt = (data, key) => CryptoJS.AES.encrypt(data, key).toString()

module.exports = (api) => {
  api.seenTimes = new Map()

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

      if (api.appConfig.general.main.livelog) {
        api.writeLog(`POST, url: ${url}, forceEncryption: ${forceEncryption}`, 'api.http.request')
      }

      const requestEncrypted =
        req.body.encrypted === true || req.body.encrypted === "true";
      const builtin = req.body.builtin === 'true' || req.body.builtin === true;
      const shieldKey = builtin ? api.BuiltinSecret : null;
      const sendWrapped = (data) => {
        const encryptResponse =
          requestEncrypted &&
          typeof shieldKey === "string" &&
          shieldKey.length > 0;

        return res.send(
          JSON.stringify(
            encryptResponse
              ? { payload: encrypt(data, shieldKey) }
              : { payload: data }
          )
        );
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
        
        const wrappedSend = async (data) => sendWrapped(data);
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

        await handler(
          {...req, body: payload, api_header: { app_id: req.body.app_id, builtin }},
          handlerResponse,
          next
        );
      } catch(e) {  
        api.log('HTTP POST error', 'setPost')
        api.log(e, 'setPost')

        if (res.headersSent) return;
        return sendWrapped(JSON.stringify({
          msg: "error",
          result: e.message,
        }));
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
        devmode: (api.appConfig.general.main.dev || process.argv.indexOf('devmode') > -1),
        rpc_api: api.rpcCalls
      },
    };

    res.send(JSON.stringify(retObj));
  });

  return api;
};
