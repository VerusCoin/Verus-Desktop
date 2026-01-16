module.exports = (api) => { 
  
  /**
   * Decrypts data given the parameters of a data descriptor, and optionally
   * evk, ivk, txid and/or if to retrieve the data from its reference.
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {Object} params The parameters to pass to decryptdata
   */
  api.native.decrypt_data = (
    coin,
    params,
  ) => {
    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "decryptdata",
          [
            params,
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

  api.setPost('/native/decrypt_data', (req, res) => {
    const {
      chainTicker,
      parameters
    } = req.body;

    api.native
      .decrypt_data(
        chainTicker,
        parameters
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