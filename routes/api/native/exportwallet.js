const { isSafeWalletFilename, isValidChainTicker } = require("./security");

module.exports = (api) => {  
  api.native.exportwallet = async (chain, filename, omitemptyaddresses) => {
    return await api.native.callDaemon(chain, "z_exportwallet", [filename, omitemptyaddresses]);
  }

  api.setPost('/native/exportwallet', async (req, res, next) => {
    const { chain, filename, omitemptyaddresses } = req.body;

    try {
      if (!isValidChainTicker(chain)) throw new Error("Invalid chain ticker");
      if (!isSafeWalletFilename(filename)) throw new Error("Wallet export filename must be a basename");
      if (omitemptyaddresses != null && typeof omitemptyaddresses !== "boolean") {
        throw new Error("omitemptyaddresses must be a boolean");
      }
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.exportwallet(chain, filename, omitemptyaddresses),
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
