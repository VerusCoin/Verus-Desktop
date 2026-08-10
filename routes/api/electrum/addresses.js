const { executeSensitiveReveal } = require("../sensitiveDataApproval");

module.exports = (api) => {  
  api.electrum.get_addresses = async (coin) => {
    const coinLc = coin.toLowerCase()
    let addresses = {
      public: [],
      private: []
    }

    if (!api.electrumKeys[coinLc] || !api.electrumKeys[coinLc].pub) {
      throw new Error(`No address found for ${coin}`);
    }

    addresses.public.push({address: api.electrumKeys[coinLc].pub, tag: 'public'})

    for (let i = 0; i < addresses.public.length; i++) {
      const addressObj = addresses.public[i];

      try {
        const addressBalances = await api.electrum.get_balances(addressObj.address, coin)
      
        addresses.public[i] = {
          ...addressObj,
          balances: { native: addressBalances.confirmed, reserve: {} },
        };
      } catch(e) {
        api.log("Error fetching balance for " + addressObj.address, "electrum.get_addresses")
        api.log(e, "electrum.get_addresses")

        addresses.public[i] = {
          ...addressObj,
          balances: null
        };
      }
    }

    return addresses
  };

  api.setPost('/electrum/get_pubkey', (req, res, next) => {
    const coin = req.body.chainTicker;
    const coinLc = coin.toLowerCase()

    if (api.electrumKeys[coinLc] && api.electrumKeys[coinLc].pubHex) {
      res.send(JSON.stringify({
        msg: 'success',
        result: api.electrumKeys[coinLc].pubHex
      }));  
    } else {
      res.send(JSON.stringify({
        msg: 'error',
        result: `No pubkey found for electrum coin ${coin}`
      }));  
    }
  });

  api.setPost('/electrum/get_privkey', async (req, res, next) => {
    const coin = req.body.chainTicker;
    const coinLc = typeof coin === "string" ? coin.toLowerCase() : "";
    const keyEntry = api.electrumKeys[coinLc];

    if (!keyEntry) {
      return res.send(JSON.stringify({
        msg: 'error',
        result: `No privkey found for electrum coin ${coin}`
      }));
    }

    const expectedAddress = keyEntry.pub || null;
    const retObj = await executeSensitiveReveal(
      api,
      req,
      {
        kind: "private-key",
        source: "electrum",
        chainTicker: coin,
        address: expectedAddress,
      },
      async (request) => {
        const currentKey = api.electrumKeys[request.chainTicker.toLowerCase()];
        if (!currentKey || (currentKey.pub || null) !== expectedAddress) {
          throw new Error("The approved Electrum wallet changed");
        }
        const privateKey = currentKey.priv;
        if (!privateKey) throw new Error(`No privkey found for electrum coin ${request.chainTicker}`);
        return privateKey;
      }
    );

    res.send(JSON.stringify(retObj));
  }, true);

  api.setGet('/electrum/get_addresses', (req, res, next) => {
    const coin = req.query.chainTicker;

    if (!req.query.chainTicker) {
      res.send(JSON.stringify({msg: 'error', result: "No coin passed to electrum get_addresses"}));
    }
    
    api.electrum.get_addresses(coin)
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

  return api;
};
