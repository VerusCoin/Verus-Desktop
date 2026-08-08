const { randomBytes } = require('crypto');
const {
  RPC_TIMEOUT,
  RPC_WORK_QUEUE_DEPTH_EXCEEDED,
  RPC_ERROR_UNKNOWN,
  RPC_OK,
  RPC_PARSE_ERROR
} = require("../utils/rpc/rpcStatusCodes");
const RpcError = require('../utils/rpc/rpcError');
const { VerusdRpcInterface } = require('verusd-rpc-ts-client');
const { isAllowedRpcMethod, isValidChainTicker } = require("./security");

module.exports = (api) => {
  api.native.getRpcInterface = (coin, systemid) => {
    const interface = new VerusdRpcInterface(
      systemid,
      "",
      undefined,
      async (req) => {
        const { params, method, id } = req;

        try {
          const res = await api.native.callDaemon(coin, method, params);

          return {
            id,
            result: res,
            error: null
          }
        } catch(e) {
          const error = {
            id,
            result: null,
            error: {
              code: -32603,
              message: e.message,
            },
          };
    
          return error;
        }
      }
    );

    return interface;
  }

  api.native.callDaemon = (coin, cmd, params) => {  
    return new Promise(async (resolve, reject) => {
      let _payload;
      let req_id = randomBytes(8).toString('hex')
  
      if (params) {
        _payload = {
          mode: null,
          chain: coin,
          cmd: cmd,
          params: params,
          rpc2cli: false, // Deprecated
        };
      } else {
        _payload = {
          mode: null,
          chain: coin,
          cmd: cmd,
          rpc2cli: false, // Deprecated
        };
      }

      if (api.appConfig.general.main.livelog) {
        api.writeLog(`chain: ${coin}, cmd: ${cmd}`, `native.rpc.request.header ${req_id}`)
        api.writeLog(params ? JSON.stringify(params) : "[]", `native.rpc.request.body ${req_id}`)
      }

      setImmediate(async () => {
        try {
          const rpcJsonParsed = api.native.convertRpcJson(await api.sendToCli(_payload))
  
          if (rpcJsonParsed.msg === 'success') {
            if (api.appConfig.general.main.livelog) {
              api.writeLog(JSON.stringify(rpcJsonParsed, null, 2), `native.rpc.success.result ${req_id}`)
            }

            resolve(rpcJsonParsed.result);
          } else {
            if (api.appConfig.general.main.livelog) {
              api.writeLog(JSON.stringify(rpcJsonParsed, null, 2), `native.rpc.error ${req_id}`)
            }

            reject(new RpcError(rpcJsonParsed.code, rpcJsonParsed.result))
          }
        } catch(e) {
          api.log(e, `native.daemon.error ${req_id}`)
          reject(new RpcError(-1, "RPC Error"))
        }
      });
    });
  }

  api.setPost('/native/call_daemon', (req, res, next) => {
    const params = req.body.params;
    const coin = req.body.chainTicker;
    const cmd = req.body.cmd;

    if (!isValidChainTicker(coin) || !isAllowedRpcMethod(cmd) || !Array.isArray(params)) {
      return res.send(JSON.stringify({
        msg: "error",
        result: "Invalid chain or daemon RPC request",
      }));
    }

    api.native.callDaemon(coin, cmd, params)
    .then((rpcRes) => {
      const retObj = {
        msg: 'success',
        result: rpcRes,
      };
  
      res.send(JSON.stringify(retObj));  
    })
    .catch(error => {
      const retObj = {
        msg: 'error',
        result: error.message,
      };
  
      res.send(JSON.stringify(retObj));  
    })
  }, true);

  api.native.convertRpcJson = (json) => {
    if (json === 'Work queue depth exceeded') {
      return {
        msg: "error",
        code: RPC_WORK_QUEUE_DEPTH_EXCEEDED,
        result: "Daemon is busy"
      };
    } else if (!json) {
      return {
        msg: "error",
        code: RPC_TIMEOUT,
        result: "No response from daemon"
      };
    } else {
      let rpcJson

      try {
        rpcJson = JSON.parse(json)
      } catch (e) {
        return {
          msg: "error",
          code: RPC_PARSE_ERROR,
          result: "JSON format unrecognized"
        };
      }
      
      if (rpcJson.code && rpcJson.code !== RPC_OK) {
        return {
          msg: "error",
          code: rpcJson.code,
          result: rpcJson.message,
        };
      } else if (rpcJson.error || rpcJson.result === "error") {
        return {
          msg: "error",
          code: rpcJson.error ? rpcJson.error.code : RPC_ERROR_UNKNOWN,
          result: rpcJson.error ? rpcJson.error.message : "Unknown error",
        };
      } else if (rpcJson.hasOwnProperty("msg") && rpcJson.hasOwnProperty("result")) {
        return rpcJson;
      } else {
        return { msg: "success", code: RPC_OK, result: rpcJson.result };
      }
    }
  }

  return api
}
