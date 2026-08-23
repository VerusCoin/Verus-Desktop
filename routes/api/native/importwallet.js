const fs = require("fs-extra");
const { isSafeWalletImportPath, isValidChainTicker } = require("./security");

module.exports = (api) => {  
  api.native.importwallet = async (chain, filename) => {
    return await api.native.callDaemon(chain, "z_importwallet", [filename]);
  }

  api.setPost('/native/importwallet', async (req, res, next) => {
    const { chain, filename } = req.body;

    try {
      if (!isValidChainTicker(chain)) throw new Error("Invalid chain ticker");
      if (!isSafeWalletImportPath(filename)) throw new Error("Wallet import path must be absolute");
      const fileStat = await fs.stat(filename);
      if (!fileStat.isFile()) throw new Error("Wallet import path must identify a file");
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.importwallet(chain, filename),
        })
      );
    } catch (e) {
      res.send(JSON.stringify({
        msg: "error",
        result: e.message
      }));
    }
  }, true);
    
  return api;
};
