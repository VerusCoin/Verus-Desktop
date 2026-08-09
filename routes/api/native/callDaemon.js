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
const { createTerminalRpcRequest } = require("./terminalRpcSecurity");

const TERMINAL_APPROVAL_ERRORS = Object.freeze({
  BUSY: "Another privileged terminal command is awaiting approval.",
  DIALOG_FAILED: "Unable to obtain terminal command approval.",
  DISPLAY_FAILED: "Unable to display this command safely.",
  INTERNAL_ERROR: "Privileged terminal command failed closed.",
  INVALID_REQUEST: "Invalid terminal command request.",
  RATE_LIMITED: "Too many terminal approval prompts. Wait and try again.",
  RPC_FAILED: "Daemon command failed. No sensitive output was returned.",
  RPC_OUTCOME_UNKNOWN:
    "The daemon did not return a confirmed result. The command may have executed; verify wallet and node state before retrying.",
  SAVE_DESTINATION_CHANGED: "The save destination changed before execution.",
  SAVE_DESTINATION_INVALID: "Unable to use the selected save destination.",
  SAVE_FAILED: "Sensitive daemon output could not be saved.",
  TARGET_CHANGED: "The daemon target changed while awaiting approval; command was not executed.",
  TARGET_UNAVAILABLE: "Unable to bind the command to a daemon target; command was not executed.",
  WINDOW_UNAVAILABLE: "A focused Verus Desktop window is required for approval.",
});

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

  api.native.callDaemon = (coin, cmd, params, options = {}) => {
    const redactLogs = options != null && options.redactLogs === true;

    return new Promise((resolve, reject) => {
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
        api.writeLog(
          redactLogs ? "[terminal parameters withheld]" : (params ? JSON.stringify(params) : "[]"),
          `native.rpc.request.body ${req_id}`
        )
      }

      setImmediate(async () => {
        try {
          const cliResponse = await api.sendToCli(
            _payload,
            {
              includeResponseMetadata: true,
              ...(options.rpcTarget == null ? {} : { rpcTarget: options.rpcTarget }),
            }
          );
          const hasResponseMetadata =
            cliResponse != null &&
            typeof cliResponse === "object" &&
            typeof cliResponse.body === "string" &&
            typeof cliResponse.confirmedDaemonResponse === "boolean";
          const confirmedDaemonResponse =
            hasResponseMetadata && cliResponse.confirmedDaemonResponse === true;
          const rpcJsonParsed = api.native.convertRpcJson(
            hasResponseMetadata ? cliResponse.body : cliResponse
          )
  
          if (rpcJsonParsed.msg === 'success') {
            if (api.appConfig.general.main.livelog) {
              api.writeLog(
                redactLogs ? "[terminal result withheld]" : JSON.stringify(rpcJsonParsed, null, 2),
                `native.rpc.success.result ${req_id}`
              )
            }

            resolve(rpcJsonParsed.result);
          } else {
            if (api.appConfig.general.main.livelog) {
              api.writeLog(
                redactLogs ? `RPC failed with code ${rpcJsonParsed.code}` : JSON.stringify(rpcJsonParsed, null, 2),
                `native.rpc.error ${req_id}`
              )
            }

            const rpcError = new RpcError(rpcJsonParsed.code, rpcJsonParsed.result);
            if (
              confirmedDaemonResponse &&
              rpcJsonParsed.code !== RPC_TIMEOUT &&
              rpcJsonParsed.code !== RPC_PARSE_ERROR
            ) {
              Object.defineProperty(rpcError, "confirmedDaemonResponse", {
                configurable: false,
                enumerable: false,
                value: true,
                writable: false,
              });
            }
            reject(rpcError)
          }
        } catch(e) {
          api.log(
            redactLogs ? "Terminal RPC transport or response parsing failed" : e,
            `native.daemon.error ${req_id}`
          )
          reject(new RpcError(-1, "RPC Error"))
        }
      });
    });
  }

  api.setPost('/native/call_daemon', async (req, res, next) => {
    const sendError = (result) => res.send(JSON.stringify({ msg: "error", result }));
    const sendSuccess = (result) => res.send(JSON.stringify({ msg: "success", result }));

    if (
      !req.api_header ||
      req.api_header.builtin !== true ||
      req.api_header.app_id !== "VERUS_DESKTOP_MAIN"
    ) {
      return sendError("The daemon terminal is available only to the built-in application.");
    }

    let request;
    try {
      // Only these three fields are copied. Renderer-supplied approval,
      // classification, operation, or save-path fields are intentionally
      // ignored, and the resulting request is deeply frozen.
      request = createTerminalRpcRequest(req.body);
    } catch (error) {
      return sendError("Invalid chain or daemon RPC request");
    }

    if (request.policy.kind === "read-only") {
      try {
        return sendSuccess(await api.native.callDaemon(
          request.chainTicker,
          request.method,
          request.params,
          { redactLogs: true }
        ));
      } catch (error) {
        return sendError(error.message);
      }
    }

    if (
      !api.terminalRpcApproval ||
      typeof api.terminalRpcApproval.execute !== "function"
    ) {
      return sendError("Native terminal approval is unavailable; command was not executed.");
    }

    let outcome;
    try {
      outcome = await api.terminalRpcApproval.execute(Object.freeze({
        chainTicker: request.chainTicker,
        method: request.method,
        params: request.params,
      }));
    } catch (error) {
      return sendError("Native terminal approval failed; command was not executed.");
    }

    if (
      outcome &&
      outcome.status === "ok" &&
      request.policy.kind !== "sensitive-output"
    ) {
      return sendSuccess(outcome.result);
    }
    if (
      outcome &&
      outcome.status === "saved" &&
      request.policy.kind === "sensitive-output"
    ) {
      return sendSuccess("Sensitive command output was saved to the selected file.");
    }
    if (outcome && outcome.status === "cancelled") {
      return sendError("Daemon command cancelled; nothing was executed.");
    }
    const hasKnownError =
      outcome &&
      typeof outcome.code === "string" &&
      Object.prototype.hasOwnProperty.call(TERMINAL_APPROVAL_ERRORS, outcome.code) &&
      typeof TERMINAL_APPROVAL_ERRORS[outcome.code] === "string";
    return sendError(
      hasKnownError
        ? TERMINAL_APPROVAL_ERRORS[outcome.code]
        : "Daemon command was not executed."
    );
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
