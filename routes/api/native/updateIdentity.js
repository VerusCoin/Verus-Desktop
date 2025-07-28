module.exports = (api) => {
  /**
   * Updates an identity using the `jsonidentity` and optional parameters.
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} jsonidentity The new definition of the identity
   * @param {Boolean} [returntx] If true, the transaction is signed by this wallet and returned
   * @param {Boolean} [tokenupdate] If true and a tokenized ID control token exists, uses the token to perform the update
   * @param {Number} [feeoffer] The non-standard fee amount to pay for the transaction
   * @param {Number} [sourceoffunds] The transparent or private address to source all funds for fees to preserve privacy of the identity
   */
  api.native.update_identity = (
    coin,
    jsonidentity,
    returntx = false,
    tokenupdate = false,
    feeoffer = undefined,
    sourceoffunds = undefined
  ) => {

    const params = [
      jsonidentity,
      returntx,
      tokenupdate,
      ...(feeoffer !== undefined ? [feeoffer] : []),
      ...(sourceoffunds !== undefined ? [sourceoffunds] : [])
    ];
  
    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "updateidentity",
          params
        )
      .then(resultObj => {
        resolve(resultObj)
      })
      .catch(err => {
        reject(err);
      });
    });
  };

  api.setPost('/native/update_identity', (req, res, next) => {
    const {
      coin,
      jsonidentity,
      returntx,
      tokenupdate,
      feeoffer,
      sourceoffunds
    } = req.body;

    api.native
      .update_identity(
        coin,
        jsonidentity,
        returntx,
        tokenupdate,
        feeoffer,
        sourceoffunds
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