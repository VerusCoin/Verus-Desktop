const fs = require('fs-extra');
const axios = require('axios')
const { normalizeRpcPort, readRpcPort } = require('./utils/rpcPort');

const RPC_CONF_UPDATE_TIMEOUT = 300000

module.exports = (api) => {
  api.getConf = (chain) => {  
    // any coind
    if (chain) {
      let _confLocation = api.confFileIndex[chain]
      api.log(`Checking conf location: ${api.confFileIndex[chain]}`, 'native.confd');

      if (fs.existsSync(_confLocation)) {
        const _rpcConf = fs.readFileSync(_confLocation, 'utf8');
        let _port = normalizeRpcPort(api.assetChainPorts[chain]);

        // any coind
        if (api.nativeCoindList[chain.toLowerCase()]) {
          _port = normalizeRpcPort(api.nativeCoindList[chain.toLowerCase()].port);
        }

        if (_rpcConf.length) {
          let _match;
          let parsedRpcConfig = {
            user: '',
            pass: '',
            port: _port,
            pendingUpdate: false,
            updateTimeoutId: null
          };

          if (_match = _rpcConf.match(/rpcuser=\s*(.*)/)) {
            parsedRpcConfig.user = _match[1];
          }

          if ((_match = _rpcConf.match(/rpcpass=\s*(.*)/)) ||
              (_match = _rpcConf.match(/rpcpassword=\s*(.*)/))) {
            parsedRpcConfig.pass = _match[1];
          }

          const configuredRpcPort = readRpcPort(_rpcConf);
          if (configuredRpcPort.found) parsedRpcConfig.port = configuredRpcPort.port;

          if (api.nativeCoindList[chain.toLowerCase()]) {
            api.rpcConf[chain] = parsedRpcConfig;
          } else {
            api.rpcConf[chain === 'komodod' ? 'KMD' : chain] = parsedRpcConfig;
          }
        } else {
          api.log(`${_confLocation} is empty`, 'native.confd');
        }
      } else {
        api.log(`${_confLocation} doesnt exist`, 'native.confd');
      }
    }
  }

  api.sendToCli = (payload, options = {}) => {
    return new Promise(async (resolve, reject) => {
      const resolveResponse = (body, confirmedDaemonResponse = false) => resolve(
        options != null && options.includeResponseMetadata === true
          ? Object.freeze({ body, confirmedDaemonResponse })
          : body
      );

      if (!payload) {  
        resolveResponse(JSON.stringify({
          result: "error",
          code: -1,
          message: 'No payload provided to send to cli'
        }))
      } else {
        const _chain = payload.chain;
        let _cmd = payload.cmd;
        const hasPinnedTarget =
          options != null &&
          Object.prototype.hasOwnProperty.call(options, "rpcTarget");
        let rpcTarget;
  
        if (hasPinnedTarget) {
          const candidate = options.rpcTarget;
          if (
            !candidate ||
            candidate.chain !== _chain ||
            !Number.isInteger(candidate.port) ||
            candidate.port < 1 ||
            candidate.port > 65535 ||
            typeof candidate.user !== "string" ||
            typeof candidate.pass !== "string"
          ) {
            resolveResponse(JSON.stringify({
              result: "error",
              error: { code: 400, message: "Approved daemon RPC target is invalid." },
            }));
            return;
          }
          rpcTarget = candidate;
        } else {
          if (!api.rpcConf[_chain]) {
            api.getConf(_chain);
          } else if (!api.rpcConf[_chain].pendingUpdate) {
            api.log(`setting ${_chain} rpc config to update in ${RPC_CONF_UPDATE_TIMEOUT/1000} seconds`, 'native.confd');
            api.rpcConf[_chain].pendingUpdate = true

            const confUpdateId = setTimeout(() => api.getConf(_chain), RPC_CONF_UPDATE_TIMEOUT)

            api.rpcConf[_chain].updateTimeoutId = confUpdateId
          }
          rpcTarget = api.rpcConf[_chain];
          if (rpcTarget) {
            const normalizedPort = normalizeRpcPort(rpcTarget.port);
            if (normalizedPort == null) {
              resolveResponse(JSON.stringify({
                result: "error",
                error: { code: 400, message: "Daemon RPC target has an invalid port." },
              }));
              return;
            }
            rpcTarget = { ...rpcTarget, port: normalizedPort };
          }
        }
  
        let _body = {
          agent: "bitcoinrpc",
          method: _cmd
        };
  
        if (payload.params) {
          _body = {
            agent: "bitcoinrpc",
            method: _cmd,
            params: payload.params === " " ? [""] : payload.params
          };
        }
  
        if (payload.chain) {
          if (!rpcTarget) {
            resolveResponse(JSON.stringify({
              result: "error",
              error: {
                code: 404,
                message: `${payload.chain} hasn't been activated yet, and its rpc config isnt loaded.`
              }
            }))
          } else {
            try {
              const res = await axios.post(
                `http://127.0.0.1:${rpcTarget.port}`,
                _body,
                {
                  // Daemon RPC payloads can contain wallet passphrases or
                  // private keys. They must never follow HTTP(S)_PROXY.
                  proxy: false,
                  timeout: 600000,
                  auth: {
                    username: rpcTarget.user,
                    password: rpcTarget.pass,
                  }
                }
              );

              resolveResponse(JSON.stringify(res.data), true)
            } catch(e) {
              if (e.code === 'ECONNREFUSED') {
                const retObj = {
                  result: "error",
                  error: {
                    code: 404,
                    message: api.coinsInitializing[payload.chain]
                      ? `Initializing ${payload.chain} daemon...`
                      : `No running ${payload.chain} daemon found.`
                  }
                };
  
                resolveResponse(JSON.stringify(retObj))
              } else if (e.response != null) {
                resolveResponse(JSON.stringify(e.response.data), true)
              } else {
                const retObj = {
                  result: "error",
                  error: {
                    code: 501,
                    message: e.message
                  }
                };
  
                resolveResponse(JSON.stringify(retObj))
              }
            }
          }
        }
      }
    })
  }

  return api;
};
