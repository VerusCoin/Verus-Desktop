module.exports = (api) => { 
  
  /**
   * Generates a z-address, viewing key, and optionally an extended secret key using either
   * a z-address in the wallet, wallet seed and hdindex, or root key (extended private key).
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} arguments The arguments to pass to z_getencryptionaddress
   */
  api.native.z_get_encryption_address = (
    coin,
    arguments,
  ) => {
    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "z_getencryptionaddress",
          [
            arguments,
          ]
        )
      .then(resultObj => {
        resolve(resultObj)
      })
      .catch(err => {
        reject(err);
      });
    });
  };

  api.setPost('/native/z_get_encryption_address', (req, res, next) => {
    const {
      chainTicker,
      arguments
    } = req.body;

    api.native
      .z_get_encryption_address(
      chainTicker,
      arguments
      )
      .then(resultObj => {
      const retObj = {
        msg: "success",
        result: resultObj
      };

      res.send(JSON.stringify(retObj));
      })
      .catch(error => {
      const retObj = {
        msg: "error",
        result: error.message
      };

      res.send(JSON.stringify(retObj));
    });
  });

  return api;
};