
module.exports = (api) => {    
  /**
   * Signs a message given the message, and an identity/address currently in the wallet
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} address The identity or address to sign the message
   * @param {String} message The message to verify
   * @param {String} cursig The current signature if multisig
   */
  api.native.sign_message = (
    coin,
    address,
    message,
    cursig = ""
  ) => {
    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "signmessage",
          [
            address,
            message,
            cursig
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

  /**
   * Signs a file given the file, and an identity/address currently in the wallet
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} address The identity or address to sign the file
   * @param {String} file The file to verify
   * @param {String} cursig The current signature if multisig
   */
  api.native.sign_file = (
    coin,
    address,
    file,
    cursig = ""
  ) => {
    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "signfile",
          [
            address,
            file,
            cursig
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

  /**
   * Signs data given the arguments including an identity/address currently in the wallet
   * and the data to be signed
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} arguments The arguments to pass to signdata
   */
  api.native.sign_data = (
    coin,
    arguments,
  ) => {
    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "signdata",
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


  api.setPost('/native/sign_message', (req, res, next) => {
    const {
      chainTicker,
      address,
      data,
      cursig
    } = req.body;

    api.native
      .sign_message(
        chainTicker,
        address,
        data,
        cursig
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

  api.setPost('/native/sign_file', (req, res, next) => {
    const {
      chainTicker,
      address,
      data,
      cursig
    } = req.body;

    api.native
      .sign_file(
        chainTicker,
        address,
        data,
        cursig
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