module.exports = (api) => {  
  api.setPost('/eth/coins/activate', (req, res, next) => {
    const _coin = req.body.chainTicker;
  
    if (_coin) {
      const _coinuc = _coin.toUpperCase();

      if (!api.eth.wallet) {
        api.eth.wallet = {};
      }

      if (api.seed) {
        const mnemonicWallet = api.eth._keys(api.seed);

        api.eth.wallet = mnemonicWallet;
      }

      if (!api.eth.coins) {
        api.eth.coins = {};
      }

      if (_coin &&
          !api.eth.coins[_coinuc]) {
        if (api.eth.wallet.signingKey &&
            api.eth.wallet.signingKey.address) {
          const network = _coin.toLowerCase().indexOf('ropsten') > -1 ? 'ropsten' : 'homestead';
          api.eth._connect(_coin, network);
          
          api.eth.coins[_coinuc] = {
            pub: api.eth.wallet.signingKey.address,
            network,
          };
        } else {
          api.eth.coins[_coinuc] = {};
        }

        const retObj = {
          msg: 'success',
          result: 'true',
        };
        res.send(JSON.stringify(retObj));
      } else {
        const retObj = {
          msg: 'success',
          result: 'true',
        };
        res.send(JSON.stringify(retObj));
      }
    } else {
      const retObj = {
        msg: 'error',
        result: 'coin param is empty',
      };
      res.send(JSON.stringify(retObj));
    }
  });

  return api; 
};