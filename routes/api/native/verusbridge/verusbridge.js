const server = require("verus_bridgekeeper");
const confFile = require("verus_bridgekeeper/confFile");
const { ROOT_SYSTEM_NAME } = require("../../utils/constants/dev_options");

module.exports = (api) => {

  api.native.start_bridgekeeper = (chainTicker) => {
    return new Promise((resolve, reject) => {
      if (chainTicker !== ROOT_SYSTEM_NAME)
        reject(new Error("bridgekeeper not currently supported outside of VRSC"));

      const setupConf = api.native.loadVethConfig();

      if (setupConf !== true) {
        reject(setupConf);
      } else {
        server.start().then((result) => {
          if (result === true) resolve(result);
          else reject(result);
        });
      }
    });
  };

  api.native.stop_bridgekeeper = (chainTicker) => {
    return new Promise((resolve, reject) => {
      if (chainTicker !== ROOT_SYSTEM_NAME)
        reject(new Error("bridgekeeper not currently supported outside of VRSC"));

      const result = server.stop();

      if (result === true) resolve(result);
      else reject(result);
    });
  };

  api.native.bridgekeeper_status = (chainTicker) => {
    return new Promise(async (resolve, reject) => {
      if (chainTicker !== ROOT_SYSTEM_NAME)
        reject(new Error("bridgekeeper not currently supported outside of VRSC"));

      const result = await server.status();

      if (result) resolve(result);
      else reject(result);
    });
  };

  api.native.bridgekeeper_setconf = (chainTicker, key, infuraLink, ethContract) => {
    return new Promise(async (resolve, reject) => {
      if (chainTicker !== ROOT_SYSTEM_NAME)
        reject(new Error("bridgekeeper not currently supported outside of VRSC"));

      let ethContractAddr;

      if (ethContract == null) {
        const veth = await api.native.get_currency(ROOT_SYSTEM_NAME, "VETH");
        const { nativecurrencyid } = veth

        ethContractAddr = nativecurrencyid.address
      } else {
        ethContractAddr = ethContract;
      }

      const result = server.set_conf(key, infuraLink, ethContractAddr, chainTicker);

      if (result) resolve(result);
      else reject(result);
    });
  };

  api.native.bridgekeeper_getconf = (chainTicker) => {
    return new Promise(async (resolve, reject) => {
      if (chainTicker !== ROOT_SYSTEM_NAME)
        reject(new Error("bridgekeeper not currently supported outside of VRSC"));

      const result = confFile.loadConfFile(chainTicker);

      if (result) {
        resolve({
          ethnode: typeof result.ethnode === "string" ? result.ethnode : "",
        });
      }
      else reject(result);
    });
  };

  api.setPost("/native/start_bridgekeeper", (req, res, next) => {
    const { chainTicker } = req.body;

    api.native
      .start_bridgekeeper(chainTicker)
      .then((reply) => {
        const retObj = {
          msg: "success",
          result: reply,
        };

        res.send(JSON.stringify(retObj));
      })
      .catch((error) => {
        const retObj = {
          msg: "error",
          result: error.message,
        };

        res.send(JSON.stringify(retObj));
      });
  });

  api.setPost("/native/stop_bridgekeeper", (req, res, next) => {
    const { chainTicker } = req.body;

    api.native
      .stop_bridgekeeper(chainTicker)
      .then((reply) => {
        const retObj = {
          msg: "BridgeKeeper Stopped",
          result: reply,
        };

        res.send(JSON.stringify(retObj));
      })
      .catch((error) => {
        const retObj = {
          msg: "error",
          result: error.message,
        };

        res.send(JSON.stringify(retObj));
      });
  });

  api.setPost("/native/bridgekeeper_status", (req, res, next) => {
    const { chainTicker } = req.body;

    api.native
      .bridgekeeper_status(chainTicker)
      .then((reply) => {
        const retObj = {
          msg: "success",
          result: reply,
        };

        res.send(JSON.stringify(retObj));
      })
      .catch((error) => {
        const retObj = {
          msg: "error",
          result: error.message,
        };

        res.send(JSON.stringify(retObj));
      });
  });

  api.setPost("/native/bridgekeeper_setconf", (req, res, next) => {
    const { key, infuraLink, ethContract, chainTicker } = req.body;
    api.native
      .bridgekeeper_setconf(chainTicker, key, infuraLink, ethContract)
      .then((reply) => {
        const retObj = {
          msg: "success",
          result: reply,
        };

        res.send(JSON.stringify(retObj));
      })
      .catch((error) => {
        const retObj = {
          msg: "error",
          result: error,
        };

        res.send(JSON.stringify(retObj));
      });
  }, true);

  api.setPost("/native/bridgekeeper_getconf", (req, res, next) => {
    const { chainTicker } = req.body;
    api.native
      .bridgekeeper_getconf(chainTicker)
      .then((reply) => {
        const retObj = {
          msg: "success",
          result: reply,
        };

        res.send(JSON.stringify(retObj));
      })
      .catch((error) => {
        const retObj = {
          msg: "error",
          result: error,
        };

        res.send(JSON.stringify(retObj));
      });
  }, true);

  return api;
};
