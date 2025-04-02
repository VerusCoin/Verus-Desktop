module.exports = (api) => { 
  
  /**
   * Decrypts data given the arguments of a data descriptor, and optionally
   * evk, ivk, txid and/or if to retrieve the data from its reference.
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} arguments The arguments to pass to decryptdata
   */
  api.native.decrypt_data = (
    coin,
    arguments,
  ) => {
    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "decryptdata",
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

  api.setPost('/native/decrypt_data', (req, res, next) => {
    const {
      chainTicker,
      arguments
    } = req.body;

    api.native
      .decrypt_data(
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