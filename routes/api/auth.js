const passwdStrength = require('passwd-strength');
const CryptoJS = require("crypto-js");
var blake2b = require('blake2b')

const decrypt = (data, key) => CryptoJS.AES.decrypt(data, key).toString(CryptoJS.enc.Utf8);
const encrypt = (data, key) => CryptoJS.AES.encrypt(data, key).toString()

module.exports = (api) => {
  api.seenTimes = {}

  api.permissionlessPaths = [
    'help',
    'request_credentials'
  ]

  api.checkToken = (validity_key, path, time, app_info) => {
    if (api.permissionlessPaths.includes(path)) return true

    const { id, builtin } = app_info
    var hash = blake2b(64)

    if (api.seenTimes.includes(time)) throw new Error("Cannot repeat call");
    else if (Math.abs(new Date().valueOf() - time) > 600000) throw new Error("Cannot make expired call.");
    else {
      let newSeenTimes = [...api.seenTimes, time]
      newSeenTimes = newSeenTimes.filter(x => (x > time - 600000 && x < time + 600000))

    if (builtin) {
      const token = api.BuiltinSecret
  
      hash.update(Buffer.from(time.toString()))
      hash.update(Buffer.from(token))
      hash.update(Buffer.from(path))
      hash.update(Buffer.from(id))
    }

    return hash.digest('hex') === validity_key
  };

  api.setPost = (url, handler, forceEncryption = false) => {
    api.rpcCalls.POST[url] = {
      type: 'POST',
      encryption_mandatory: forceEncryption,
      url
    }

    api.post(url, async (req, res, next) => {
      const encrypted = req.body.encrypted || forceEncryption

      try {
        let payload = null
        const builtin = req.body.builtin === 'true' || req.body.builtin === true
        const shieldKey = builtin ? api.BuiltinSecret : null

        if (
          !api.checkToken(
            req.body.validity_key,
            url.replace('/', ''),
            Number(req.body.time),
            { id: req.body.app_id, builtin }
          )
        )
          throw new Error("Incorrect API validity key");
        
        if (!encrypted) {
          payload = req.body.payload;
        } else {
          payload = JSON.parse(decrypt(req.body.payload, shieldKey))
        }
        
        handler({...req, body: payload, api_header: { app_id: req.body.app_id, builtin }}, {
          ...res,
          send: async (data) => {
            res.send(
              JSON.stringify(
                encrypted
                  ? { payload: encrypt(data, shieldKey) }
                  : { payload: data }
              )
            );
          }
        }, next)
      } catch(e) {  
        api.log('HTTP POST error', 'setPost')
        api.log(e, 'setPost')

        res.send(
          JSON.stringify({
            payload: JSON.stringify({
              msg: "error",
              result: e.message,
            }),
          })
        );
      }
    })
  }

  api.setGet = (url, handler) => {
    api.rpcCalls.GET[url] = {
      type: 'GET',
      url
    }

    api.get(url, async (req, res, next) => {
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