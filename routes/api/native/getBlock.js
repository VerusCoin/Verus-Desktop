module.exports = (api) => {
  /**
   * Gets the version, hashtype and height from a signature.
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} hashorheight The block hash or height
   * @param {String} verbosity The verbosity of the result. 0 for hex encoded data, 1 for a json object, and 2 for json object with transaction data
   */
  api.native.get_block = (
    coin,
    hashorheight,
    verbosity = 1,
  ) => {
    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "getblock",
          [
            hashorheight,
            verbosity
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

  api.setPost('/native/get_block', (req, res, next) => {
    const {
      chainTicker,
      hashorheight,
      verbosity
    } = req.body;

    api.native
      .get_block(
        chainTicker,
        hashorheight,
        verbosity
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
}