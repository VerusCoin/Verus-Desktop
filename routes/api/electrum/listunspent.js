// TODO: watchonly spendable switch

const { checkTimestamp } = require('agama-wallet-lib/src/time');
const { pubToElectrumScriptHashHex } = require('agama-wallet-lib/src/keys');
const btcnetworks = require('agama-wallet-lib/src/bitcoinjs-networks');
const UTXO_1MONTH_THRESHOLD_SECONDS = 2592000;

module.exports = (api) => {
  api.electrum.listunspent = (ecl, address, network, full, verify) => {
    let _address = address;
    let _atLeastOneDecodeTxFailed = false;

    if (api.electrum.coinData[network.toLowerCase()].nspv) {
      ecl = api.nspvWrapper(network.toLowerCase());
    } else {
      _address = ecl.protocolVersion && ecl.protocolVersion === '1.4' ? pubToElectrumScriptHashHex(address, btcnetworks[network.toLowerCase()] || btcnetworks.kmd) : address;
    }

    if (full &&
        !ecl.insight) {
      return new Promise((resolve, reject) => {
        ecl.blockchainAddressListunspent(_address)
        .then((_utxoJSON) => {
          if (_utxoJSON &&
              _utxoJSON.length) {
            let formattedUtxoList = [];
            let _utxo = [];

            api.electrumGetCurrentBlock(network, api.electrum.coinData[network.toLowerCase()].nspv)
            .then((currentHeight) => {
              if (api.electrum.coinData[network.toLowerCase()].nspv) {
                nspvGetinfo = JSON.parse(JSON.stringify(currentHeight));
                currentHeight = nspvGetinfo.height;
              }
                
              if (currentHeight &&
                  Number(currentHeight) > 0) {
                // filter out unconfirmed utxos
                for (let i = 0; i < _utxoJSON.length; i++) {
                  if (Number(currentHeight) - Number(_utxoJSON[i].height) !== 0) {
                    _utxo.push(_utxoJSON[i]);
                    console.log('utxo '+ i);
                    console.log(_utxoJSON[i]);
                  }
                }

                if (!_utxo.length) { // no confirmed utxo
                  resolve('no valid utxo');
                } else {
                  if (api.electrum.coinData[network.toLowerCase()].nspv) {
                    let _utxosNspv = [];

                    if (network === 'komodo' ||
                        network.toLowerCase() === 'kmd') {
                      for (let i = 0; i < _utxoJSON.length; i++) {
                        const _utxoItem = _utxoJSON[i];

                        _utxosNspv.push({
                          txid: _utxoItem.tx_hash,
                          vout: _utxoItem.tx_pos,
                          address,
                          amount: Number(_utxoItem.value) * 0.00000001,
                          amountSats: _utxoItem.value,
                          interest: _utxoItem.rewards >= 0 ? Number((_utxoItem.rewards * 0.00000001).toFixed(8)) : 0,
                          interestSats: _utxoItem.rewards >= 0 ? _utxoItem.rewards : 0,
                          confirmations: Number(_utxoItem.height) === 0 ? 0 : currentHeight - _utxoItem.height,
                          height: _utxoItem.height,
                          currentHeight,
                          spendable: true,
                          dpowSecured: nspvGetinfo.notarization && Number(nspvGetinfo.notarization.notarized_height) >= Number(_utxoItem.height) ? true : false,
                          verified: true,
                        });
                      }
                    } else {
                      for (let i = 0; i < _utxoJSON.length; i++) {
                        const _utxoItem = _utxoJSON[i];

                        _utxosNspv.push({
                          txid: _utxoItem.tx_hash,
                          vout: _utxoItem.tx_pos,
                          address,
                          amount: Number(_utxoItem.value) * 0.00000001,
                          amountSats: _utxoItem.value,
                          confirmations: Number(_utxoItem.height) === 0 ? 0 : currentHeight - _utxoItem.height,
                          height: _utxoItem.height,
                          currentHeight,
                          spendable: true,
                          dpowSecured: nspvGetinfo.notarization && Number(nspvGetinfo.notarization.notarized_height) >= Number(_utxoItem.height) ? true : false,
                          verified: true,
                        });
                      }
                    }
                    resolve(_utxosNspv);
                  } else {
                    Promise.all(_utxo.map((_utxoItem, index) => {
                      return new Promise((resolve, reject) => {
                        api.getTransaction(_utxoItem.tx_hash, network, ecl)
                        .then((_rawtxJSON) => {
                          // decode tx
                          const _network = api.getNetworkData(network);
                          let decodedTx;

                          if (api.getTransactionDecoded(_utxoItem.tx_hash, network)) {
                            decodedTx = api.getTransactionDecoded(_utxoItem.tx_hash, network);
                          } else {
                            decodedTx = api.electrumJSTxDecoder(
                              _rawtxJSON,
                              network,
                              _network
                            );
                            api.getTransactionDecoded(
                              _utxoItem.tx_hash,
                              network,
                              decodedTx
                            );
                          }

                          // api.log('decoded tx =>', true);
                          // api.log(decodedTx, true);
                          
                          if (!decodedTx) {
                            _atLeastOneDecodeTxFailed = true;
                            resolve('cant decode tx');
                          } else {
                            if (network === 'komodo' ||
                                network.toLowerCase() === 'kmd') {
                              let interest = 0;

                              if (Number(_utxoItem.value) * 0.00000001 >= 10 &&
                                  decodedTx.format.locktime > 0) {
                                interest = api.kmdCalcInterest(
                                  decodedTx.format.locktime,
                                  _utxoItem.value,
                                  _utxoItem.height
                                );
                              }

                              const _locktimeSec = checkTimestamp(decodedTx.format.locktime * 1000);
                              let _resolveObj = {
                                txid: _utxoItem.tx_hash,
                                vout: _utxoItem.tx_pos,
                                address,
                                amount: Number(_utxoItem.value) * 0.00000001,
                                amountSats: _utxoItem.value,
                                locktime: decodedTx.format.locktime,
                                interest: interest >= 0 ? Number((interest * 0.00000001).toFixed(8)) : 0,
                                interestSats: interest >= 0 ? interest : 0,
                                timeElapsedFromLocktimeInSeconds: decodedTx.format.locktime ? _locktimeSec : 0,
                                timeTill1MonthInterestStopsInSeconds: decodedTx.format.locktime ? (UTXO_1MONTH_THRESHOLD_SECONDS - _locktimeSec > 0 ? UTXO_1MONTH_THRESHOLD_SECONDS - _locktimeSec : 0) : 0,
                                interestRulesCheckPass: !decodedTx.format.locktime || Number(decodedTx.format.locktime) === 0 || _locktimeSec > UTXO_1MONTH_THRESHOLD_SECONDS || _utxoItem.value < 1000000000 ? false : true,
                                confirmations: Number(_utxoItem.height) === 0 ? 0 : currentHeight - _utxoItem.height,
                                height: _utxoItem.height,
                                currentHeight,
                                spendable: true,
                                verified: false,
                              };

                              if (api.electrum.coinData[network.toLowerCase()].nspv) {
                                _resolveObj.dpowSecured = nspvGetinfo.notarization && Number(nspvGetinfo.notarization.notarized_height) >= Number(_utxoItem.height) ? true : false,
                                _resolveObj.verified = true;
                                resolve(_resolveObj);
                              } else {
                                if (api.dpowCoins.indexOf(network.toUpperCase()) > -1 &&
                                    api.electrumCache[network] &&
                                    api.electrumCache[network].verboseTx &&
                                    api.electrumCache[network].verboseTx[_utxoItem.tx_hash] &&
                                    api.electrumCache[network].verboseTx[_utxoItem.tx_hash].hasOwnProperty('confirmations')) {
                                  if (api.electrumCache[network].verboseTx[_utxoItem.tx_hash].confirmations >= 2) {
                                    _resolveObj.dpowSecured = true;
                                  } else {
                                    _resolveObj.dpowSecured = false;
                                  }
                                }

                                // merkle root verification against another electrum server
                                if (verify) {
                                  api.verifyMerkleByCoin(
                                    api.findCoinName(network),
                                    _utxoItem.tx_hash,
                                    _utxoItem.height
                                  )
                                  .then((verifyMerkleRes) => {
                                    if (verifyMerkleRes &&
                                        verifyMerkleRes === api.CONNECTION_ERROR_OR_INCOMPLETE_DATA) {
                                      verifyMerkleRes = false;
                                    }

                                    _resolveObj.verified = verifyMerkleRes;
                                    resolve(_resolveObj);
                                  }).catch(reject);
                                } else {
                                  resolve(_resolveObj);
                                }
                              }
                            } else {
                              let _resolveObj = {
                                txid: _utxoItem.tx_hash,
                                vout: _utxoItem.tx_pos,
                                address,
                                amount: Number(_utxoItem.value) * 0.00000001,
                                amountSats: _utxoItem.value,
                                confirmations: Number(_utxoItem.height) === 0 ? 0 : currentHeight - _utxoItem.height,
                                height: _utxoItem.height,
                                currentHeight,
                                spendable: true,
                                verified: false,
                              };

                              if (api.electrum.coinData[network.toLowerCase()].nspv) {
                                _resolveObj.dpowSecured = nspvGetinfo.notarization && Number(nspvGetinfo.notarization.notarized_height) >= Number(_utxoItem.height) ? true : false,
                                _resolveObj.verified = true;
                                resolve(_resolveObj);
                              } else {
                                if (api.dpowCoins.indexOf(network.toUpperCase()) > -1 &&
                                    api.electrumCache[network] &&
                                    api.electrumCache[network].verboseTx &&
                                    api.electrumCache[network].verboseTx[_utxoItem.tx_hash] &&
                                    api.electrumCache[network].verboseTx[_utxoItem.tx_hash].hasOwnProperty('confirmations')) {
                                  if (api.electrumCache[network].verboseTx[_utxoItem.tx_hash].confirmations >= 2) {
                                    _resolveObj.dpowSecured = true;
                                  } else {
                                    _resolveObj.dpowSecured = false;
                                  }
                                }

                                // merkle root verification against another electrum server
                                if (verify) {
                                  api.verifyMerkleByCoin(
                                    api.findCoinName(network),
                                    _utxoItem.tx_hash,
                                    _utxoItem.height
                                  )
                                  .then((verifyMerkleRes) => {
                                    if (verifyMerkleRes &&
                                        verifyMerkleRes === api.CONNECTION_ERROR_OR_INCOMPLETE_DATA) {
                                      verifyMerkleRes = false;
                                    }

                                    _resolveObj.verified = verifyMerkleRes;
                                    resolve(_resolveObj);
                                  }).catch(reject);
                                } else {
                                  resolve(_resolveObj);
                                }
                              }
                            }
                          }
                        }).catch(reject);
                      });
                    }))
                    .then(promiseResult => {
                      if (!_atLeastOneDecodeTxFailed) {
                        resolve(promiseResult);
                      } else {
                        resolve('decode error');
                      }
                    }).catch(reject);
                  }
                }
              } else {
                resolve('cant get current height');
              }
            }).catch(reject);
          } else {
            resolve(api.CONNECTION_ERROR_OR_INCOMPLETE_DATA);
          }
        }).catch(reject);
      });
    } else {
      return new Promise((resolve, reject) => {
        ecl.blockchainAddressListunspent(_address)
        .then((json) => {
          if (json &&
              json.length) {
            resolve(json);
          } else {
            resolve(api.CONNECTION_ERROR_OR_INCOMPLETE_DATA);
          }
        }).catch(reject);
      });
    }
  }

  api.setGet('/electrum/listunspent', (req, res, next) => {
    async function _getListunspent() {
      const network = req.query.network || api.validateChainTicker(req.query.coin);
      const ecl = api.electrum.coinData[network.toLowerCase()] && api.electrum.coinData[network.toLowerCase()].nspv ? {} : await api.ecl(network);

      if (req.query.full &&
          req.query.full === 'true') {
        return api.electrum.listunspent(
          ecl,
          req.query.address,
          network,
          true,
          req.query.verify
        )
        .then((listunspent) => {
          const retObj = {
            msg: 'success',
            result: listunspent,
          };

          res.send(JSON.stringify(retObj));
        });
      } else {
        return api.electrum.listunspent(ecl, req.query.address, network)
        .then((listunspent) => {
          const retObj = {
            msg: 'success',
            result: listunspent,
          };

          res.send(JSON.stringify(retObj));
        });
      }
    };
    _getListunspent().catch((error) => {
      res.send(JSON.stringify({ msg: 'error', result: error.message }));
    });
  });

  return api;
};
