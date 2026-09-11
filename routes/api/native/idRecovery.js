const { assertSingleSignatureIdentity } = require("./identityUpdatePolicy");

module.exports = (api) => {
  /**
   * Recovers an ID given the information
   * @param {String} coin The chainTicker of the coin that the ID is based on
   * @param {String} name The name of the ID to reserve
   * @param {String[]} primaryaddresses An array of the primary addresses for this id
   * @param {Number} minimumsignatures The minimum signatures required to sign a tx for this ID
   * @param {Object} contentmap The content to initially attach to this id
   * @param {String} revocationauthority The ID that can revoke this ID
   * @param {String} recoveryauthority The ID that can recover this ID
   * @param {String} privateaddress The private address attached to this ID
   */
  api.native.recover_id = (
    coin,
    name,
    primaryaddresses,
    minimumsignatures = 1,
    contentmap = null,
    revocationauthority,
    recoveryauthority,
    privateaddress,
  ) => {
    let idJson = {
      primaryaddresses,
      minimumsignatures,
      contentmap: contentmap,
      revocationauthority,
      recoveryauthority,
      privateaddress
    }

    if (privateaddress == null) {
      delete idJson.privateaddress
    }

    return new Promise((resolve, reject) => {
      api.native
        .callDaemon(
          coin,
          "getidentity",
          [name]
        )
      .then(idObj => {
        if (!idObj) throw new Error(`${name} ID not found.`)
        assertSingleSignatureIdentity(idObj.identity);
        assertSingleSignatureIdentity(idJson);
        idJson.name = idObj.identity.name
        idJson.parent = idObj.identity.parent
        idJson.identityaddress = idObj.identity.identityaddress
        idJson.version = idObj.identity.version
        idJson.contentmap = contentmap == null ? idObj.contentmap : contentmap;

        //idJson.flags = idObj.identity.flags

        return api.native
        .callDaemon(
          coin,
          "recoveridentity",
          [idJson]
        )
      })
      .then(idRecoveryResult => {
        resolve({
          chainTicker: coin,
          ...idJson,
          resulttxid: idRecoveryResult
        })
      })
      .catch(err => {
        reject(err);
      });
    });
  };

  //TODO: Add more checks in here as well
  api.native.recover_id_preflight = async (
    coin,
    name,
    primaryaddresses,
    minimumsignatures = 1,
    contentmap = null,
    revocationauthority,
    recoveryauthority,
    privateaddress,
  ) => {
    const idObj = await api.native.callDaemon(coin, "getidentity", [name]);
    assertSingleSignatureIdentity(idObj && idObj.identity);
    assertSingleSignatureIdentity({ primaryaddresses, minimumsignatures });
    return {
      chainTicker: coin,
      name,
      primaryaddresses,
      minimumsignatures,
      contentmap,
      revocationauthority,
      recoveryauthority,
      privateaddress,
    };
  };

  api.setPost('/native/recover_id', (req, res, next) => {
    const {
      chainTicker,
      name,
      primaryaddresses,
      minimumsignatures,
      contentmap,
      revocationauthority,
      recoveryauthority,
      privateaddress,
    } = req.body;

    api.native
      .recover_id(
        chainTicker,
        name,
        primaryaddresses,
        minimumsignatures,
        contentmap,
        revocationauthority,
        recoveryauthority,
        privateaddress,
      )
      .then(recoveryObj => {
        const retObj = {
          msg: "success",
          result: recoveryObj
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

  api.setPost('/native/recover_id_preflight', (req, res, next) => {
    const {
      chainTicker,
      name,
      primaryaddresses,
      minimumsignatures,
      contentmap,
      revocationauthority,
      recoveryauthority,
      privateaddress,
    } = req.body;

    api.native
      .recover_id_preflight(
        chainTicker,
        name,
        primaryaddresses,
        minimumsignatures,
        contentmap,
        revocationauthority,
        recoveryauthority,
        privateaddress,
      )
      .then(idRecoveryResult => {
        const retObj = {
          msg: "success",
          result: idRecoveryResult
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
