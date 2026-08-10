const { ethers } = require("ethers");
const { executeSensitiveReveal } = require("../sensitiveDataApproval");

module.exports = (api) => { 
  api.eth.get_address = () => {
    if (api.eth.wallet != null) {
      return api.eth.wallet.address
    } else {
      throw new Error("No wallet authenticated, cannot get wallet address for ETH")
    }
  };

  api.eth.get_addresses = async () => {
    return {
      public: [{
        address: api.eth.get_address(),
        tag: "eth",
        balances: {
          native: ethers.formatEther(await api.eth.get_wallet_balance()),
          reserve: {}
        }
      }],
      private: []
    }
  };

  api.setGet('/eth/get_addresses', (req, res, next) => {    
    api.eth.get_addresses()
    .then((addresses) => {
      const retObj = {
        msg: 'success',
        result: addresses,
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

  api.setPost('/eth/get_privkey', async (req, res, next) => {
    if (api.eth.wallet == null) {
      return res.send(JSON.stringify({
        msg: 'error',
        result: `No ETH privkey found`
      }));
    }

    const expectedAddress = api.eth.wallet.address;
    const retObj = await executeSensitiveReveal(
      api,
      req,
      {
        kind: "private-key",
        source: "eth",
        chainTicker: req.body.chainTicker,
        address: expectedAddress,
      },
      async () => {
        if (api.eth.wallet == null || api.eth.wallet.address !== expectedAddress) {
          throw new Error("The approved Ethereum wallet changed");
        }
        return api.eth.wallet.signer.signingKey.privateKey;
      }
    );

    res.send(JSON.stringify(retObj));
  }, true);

  return api;
};
