const { assertSingleSignatureIdentity } = require("./identityUpdatePolicy");

module.exports = (api) => {    
  api.native.revoke_id = (coin, name) => {
    return new Promise((resolve, reject) => {      
      api.native.callDaemon(coin, 'getidentity', [name])
      .then(idObj => {
        assertSingleSignatureIdentity(idObj && idObj.identity);
        return api.native.callDaemon(coin, 'revokeidentity', [name]);
      })
      .then((txid) => {
        resolve({
          name,
          txid
        })
      })
      .catch(err => {
        reject(err)
      })
    });
  };

  api.setPost('/native/revoke_id', (req, res, next) => {
    const { chainTicker, name } = req.body

    api.native.revoke_id(chainTicker, name)
    .then((revocationResult) => {
      const retObj = {
        msg: 'success',
        result: revocationResult,
      };
  
      res.send(JSON.stringify(retObj));  
    })
    .catch(error => {
      const retObj = {
        msg: 'error',
        result: error.message,
      };
  
      res.send(JSON.stringify(retObj));  
    })
  });

  return api
};
