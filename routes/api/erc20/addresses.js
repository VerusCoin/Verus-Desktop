const { ethers } = require("ethers");
const { executeSensitiveReveal } = require("../sensitiveDataApproval");

module.exports = (api) => { 
  api.erc20.get_address = () => {
    if (api.erc20.wallet != null) {
      return api.erc20.wallet.address
    } else {
      throw new Error("No wallet authenticated, cannot get wallet address for ERC20")
    }
  };

  api.erc20.get_addresses = async (contractId) => {
    return {
      public: [
        {
          address: api.erc20.get_address(),
          tag: "eth",
          balances: {
            native: ethers.formatUnits(
              await api.erc20.get_wallet_balance(contractId),
              api.erc20.contracts[contractId].decimals
            ),
            reserve: {},
          },
        },
      ],
      private: [],
    };
  };

  api.setGet('/erc20/get_addresses', (req, res, next) => {    
    api.erc20.get_addresses(req.query.chainTicker)
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

  api.setPost('/erc20/get_privkey', async (req, res, next) => {
    if (api.erc20.wallet == null) {
      return res.send(JSON.stringify({
        msg: 'error',
        result: `No ETH privkey found`
      }));
    }

    const expectedAddress = api.erc20.wallet.address;
    const retObj = await executeSensitiveReveal(
      api,
      req,
      {
        kind: "private-key",
        source: "erc20",
        chainTicker: req.body.chainTicker,
        address: expectedAddress,
      },
      async () => {
        if (api.erc20.wallet == null || api.erc20.wallet.address !== expectedAddress) {
          throw new Error("The approved ERC-20 wallet changed");
        }
        return api.erc20.wallet.signer.signingKey.privateKey;
      }
    );

    res.send(JSON.stringify(retObj));
  }, true);

  return api;
};
