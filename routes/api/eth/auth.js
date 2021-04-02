const ethers = require('ethers');

module.exports = (api) => {  
  api.setPost('/eth/auth', (req, res, next) => {
    let seed = req.body.seed;

    if (!api.seed) {
      api.seed = seed;
    }

    const mnemonicWallet = api.eth._keys(seed, true);

    api.eth.wallet = mnemonicWallet;
    api.eth.connect = {};

    const retObj = {
      msg: 'success',
      result: 'success',
    };

    res.send(JSON.stringify(retObj));
  }, true);

  api.setGet('/eth/check_auth', (req, res, next) => {
    res.send(JSON.stringify({
      msg: 'success',
      result: api.eth.wallet != null && api.eth.wallet.signingKey != null,
    }));
  });

  api.setPost('/eth/logout', (req, res, next) => {
    api.eth.wallet = null;
    api.eth.connect = null;
    api.ethPriv = null;

    for (let key in api.eth.coins) {
      api.eth.coins[key] = {};
    }

    const retObj = {
      msg: 'success',
      result: 'success',
    };

    res.send(JSON.stringify(retObj));
  });

  return api; 
};
