const { GetOffersRequest } = require('verus-typescript-primitives');

module.exports = (api) => {    
  api.native.get_identities = (coin, includeCanSpend = true, includeCanSign = false, includeWatchOnly = false, includeOffers = false) => {
    const promiseArr = [
      api.native.callDaemon(coin, 'listidentities', [includeCanSpend, includeCanSign, includeWatchOnly]),
      api.native.callDaemon(coin, "z_gettotalbalance", [])
    ]

    return new Promise((resolve, reject) => {      
      Promise.all(promiseArr)
      .then(async (resultArr) => {
        const identities = resultArr[0]
        const balances = resultArr[1]
        const totalBalance = Number(balances.total)

        if (!identities) {
          resolve([])
        } else {
          let formattedIds = identities.slice()
          let txcount = null
          let reserve_balance = null
          let useCache = true
          let openOffers = {}

          try {
            const walletinfo = await api.native.callDaemon(coin, "getwalletinfo", [])
            txcount = walletinfo.txcount
            reserve_balance = walletinfo.reserve_balance
          } catch (e) {
            useCache = false
            api.log('Not using address balance cache:', 'get_identities')
            api.log(e, 'get_identities')
          }

          try {
            openOffers = await api.native.callDaemon(coin, "listopenoffers", [])
          } catch (e) {
            api.log('Failed to fetch open offers:', 'get_identities')
            api.log(e, 'get_identities')
          }
          
          for (let i = 0; i < formattedIds.length; i++) {
            const iAddr = identities[i].identity.identityaddress
            const zAddr = identities[i].identity.privateaddress
            let zBalance = null
            let iBalances = {}

            iBalances = await api.native.get_addr_balance(
              coin,
              iAddr,
              useCache,
              txcount,
              totalBalance,
              reserve_balance
            );
            const tBalance = iBalances[coin]
            
            if (zAddr != null) {
              try {
                zBalance = Number(
                  await api.native.get_addr_balance(
                    coin,
                    zAddr,
                    useCache,
                    txcount,
                    totalBalance,
                    reserve_balance
                  )
                );
              } catch (e) {
                api.log(e, "get_identities");
              }
            }
            
            formattedIds[i].balances = {
              native: {
                public: {
                  confirmed: tBalance,
                  unconfirmed: null,
                  immature: null
                },
                private: {
                  confirmed: zBalance
                }
              },
              reserve: {...iBalances, [coin]: null}
            }

            formattedIds[i].addresses = {
              public: [{
                address: iAddr,
                balances: {
                  native: tBalance,
                  reserve: {...iBalances, [coin]: null}
                },
                tag: "identity"
              }],
              private: zAddr == null ? [] : [{
                address: zAddr,
                balances: {
                  native: zBalance,
                  reserve: {}
                },
                tag: "sapling"
              }]
            }

            const recoveryId = identities.find(
              (listIdentityObject) => {
                return (
                  listIdentityObject.identity.identityaddress ===
                  formattedIds[i].identity.recoveryauthority
                );
              }
            );

            formattedIds[i].canwriterecovery = recoveryId != null && recoveryId.status === 'active'
            formattedIds[i].canwriterevocation = formattedIds[i].canwriterecovery

            if (
              formattedIds[i].identity.parent !==
                "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV" &&
              formattedIds[i].identity.parent !==
                "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq" && 
              formattedIds[i].identity.parent !==
                "i3UXS5QPRQGNRDDqVnyWTnmFCTHDbzmsYk"
            ) {
              try {
                formattedIds[i].identity.name = `${
                  formattedIds[i].identity.name
                }.${
                  (
                    await api.native.get_currency_definition(
                      coin,
                      formattedIds[i].identity.parent
                    )
                  ).name
                }`;
              } catch(e) {
                api.log('Failed to get parent for ' + formattedIds[i].identity.name, 'get_identities')
                api.log(e, 'get_identities')
              }
            }

            if (formattedIds[i].status === 'active') {
              formattedIds[i].canrevoke = identities.some(
                (listIdentityObject) => {
                  return (
                    listIdentityObject.identity.identityaddress !==
                      formattedIds[i].identity.identityaddress &&
                    listIdentityObject.identity.identityaddress ===
                    formattedIds[i].identity.revocationauthority && 
                    listIdentityObject.status === 'active'
                  );
                }
              );
            } else formattedIds[i].canrevoke = false

            if (
              formattedIds[i].status === "revoked" &&
              recoveryId != null &&
              recoveryId.status === "active"
            ) {
              formattedIds[i].canrecover =
                recoveryId.identity.identityaddress !==
                formattedIds[i].identity.identityaddress;
            } else formattedIds[i].canrecover = false;
          }

          if (includeOffers) {
            for (let i = 0; i < formattedIds.length; i++) {
              try {
                formattedIds[i].offers = (await api.native.getoffers(
                  new GetOffersRequest(
                    coin,
                    formattedIds[i].identity.identityaddress,
                    false,
                    false
                  ),
                  formattedIds,
                  openOffers
                ))
              } catch(e) {
                api.log(`Failed to get offers for ${formattedIds[i].identity.name}`, 'get_identities');
                api.log(e, 'get_identities');
              }
            }
          }

          resolve(formattedIds)
        } 
      })
      .catch(err => {
        reject(err)
      })
    });
  };

  api.setPost('/native/get_identities', (req, res, next) => {    
    const { chainTicker, includeCanSpend, includeCanSign, includeWatchOnly, includeOffers } =
      req.body;

    api.native.get_identities(chainTicker, includeCanSpend, includeCanSign, includeWatchOnly, includeOffers)
    .then((identities) => {
      const retObj = {
        msg: 'success',
        result: identities,
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

  api.native.get_identity = (coin, name) => {
    return new Promise((resolve, reject) => {      
      api.native.callDaemon(coin, 'getidentity', [name])
      .then(async (identity) => {
        if (
          identity.identity.parent !==
            "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV" &&
            identity.identity.parent !==
            "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq" &&
            // Avoid trying to get the null parent of VRSC or VRSCTEST.
            identity.identity.parent !== 
            "i3UXS5QPRQGNRDDqVnyWTnmFCTHDbzmsYk"
        ) {
          identity.identity.name = `${identity.identity.name}.${
            (
              await api.native.get_currency_definition(
                coin,
                identity.identity.parent
              )
            ).name
          }`;
        }

        try {
          identity.offers = await api.native.getoffers(
            new GetOffersRequest(coin, identity.identity.identityaddress, false, false)
          );
        } catch (e) {
          api.log(`Failed to get offers for ${identity.identity.name}`, "get_identity");
          api.log(e, "get_identity");
        }

        resolve(identity)
      })
      .catch(err => {
        reject(err)
      })
    });
  };

  api.setPost('/native/get_identity', (req, res, next) => {
    const { chainTicker, name } = req.body

    api.native.get_identity(chainTicker, name)
    .then((identity) => {
      const retObj = {
        msg: 'success',
        result: identity,
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

  api.native.get_identity_content = (coin, name) => {
    return new Promise((resolve, reject) => {      
      api.native.callDaemon(coin, 'getidentitycontent', [name])
      .then(async (identity) => {
        if (
          identity.identity.parent !==
            "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV" &&
            identity.identity.parent !==
            "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq" &&
            // Avoid trying to get the null parent of VRSC or VRSCTEST.
            identity.identity.parent !== 
            "i3UXS5QPRQGNRDDqVnyWTnmFCTHDbzmsYk"
        ) {
          identity.identity.name = `${identity.identity.name}.${
            (
              await api.native.get_currency_definition(
                coin,
                identity.identity.parent
              )
            ).name
          }`;
        }

        try {
          identity.offers = await api.native.getoffers(
            new GetOffersRequest(coin, identity.identity.identityaddress, false, false)
          );
        } catch (e) {
          api.log(`Failed to get offers for ${identity.identity.name}`, "get_identity_content");
          api.log(e, "get_identity_content");
        }

        resolve(identity)
      })
      .catch(err => {
        reject(err)
      })
    });
  };

  api.setPost('/native/get_identity_content', (req, res, next) => {
    const { chainTicker, name } = req.body

    api.native.get_identity_content(chainTicker, name)
    .then((identity) => {
      const retObj = {
        msg: 'success',
        result: identity,
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