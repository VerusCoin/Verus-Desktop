const { dialog } = require("electron");
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
      const confirmation = await dialog.showMessageBox({
        type: "warning",
        title: "Import Wallet?",
        message: `Import private keys into ${chain} from this file?\n\n${filename}`,
        buttons: ["Cancel", "Import"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirmation.response !== 1) throw new Error("Wallet import cancelled");

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
