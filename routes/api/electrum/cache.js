const fs = require('fs-extra');
const _fs = require('graceful-fs');
const fsnode = require('fs');
const {
  parseBlock,
  electrumMerkleRoot,
} = require('agama-wallet-lib/src/block');
const btcnetworks = require('agama-wallet-lib/src/bitcoinjs-networks');

// TODO: dpow confs cache storage, eth/erc20 pending txs cache

module.exports = (api) => {
  api.updatePendingTxCache = (network, txid, options) => {
    network = network.toUpperCase();

    if (options.hasOwnProperty('remove') &&
        api.electrumCache.pendingTx &&
        api.electrumCache.pendingTx[network] &&
        api.electrumCache.pendingTx[network][txid]) {
        delete api.electrumCache.pendingTx[network][txid];

      if (!Object.keys(api.electrumCache.pendingTx[network]).length) {
        delete api.electrumCache.pendingTx[network];
      }
    } else {
      if (!api.electrumCache.pendingTx) {
        api.electrumCache.pendingTx = {};
      }
      if (!api.electrumCache.pendingTx[network]) {
        api.electrumCache.pendingTx[network] = {};
      }

      if (!api.electrumCache.pendingTx[network][txid]) {
        api.electrumCache.pendingTx[network][txid] = api.electrum.coinData[network.toLowerCase()].nspv ? {
          pub: options.pub,
          rawtx: options.rawtx,
          value: options.value || null, // nspv pending tx workaround
        } : {
          pub: options.pub,
          rawtx: options.rawtx,
        };
      } 
    }
  };

  api.findPendingTxByAddress = (network, pub) => {
    let _items = [];

    if (api.electrumCache.pendingTx &&
        api.electrumCache.pendingTx[network] &&
        Object.keys(api.electrumCache.pendingTx[network]).length) {
      const _txs = api.electrumCache.pendingTx[network];
      
      for (let key in _txs) {
        if (_txs[key].pub === pub) {
          _items.push(api.electrum.coinData[network.toLowerCase()].nspv ? {
            txid: key,
            rawtx: api.electrumCache.pendingTx[network][key].rawtx,
            value: api.electrumCache.pendingTx[network][key].value, // nspv pending tx workaround
          } : {
            txid: key,
            rawtx: api.electrumCache.pendingTx[network][key].rawtx,
          });
        }
      }
    }

    return _items;
  };

  api.findPendingTxRawById = (network, txid) => {
    if (api.electrumCache.pendingTx &&
        api.electrumCache.pendingTx[network] &&
        api.electrumCache.pendingTx[network][txid]) {
      return api.electrumCache.pendingTx[network][txid].rawtx;
    }

    return null;
  };

  api.loadLocalSPVCache = () => {
    if (fs.existsSync(`${api.paths.agamaDir}/spv-cache.json`)) {
      const localCache = fs.readFileSync(`${api.paths.agamaDir}/spv-cache.json`, 'utf8');

      try {
        api.electrumCache = JSON.parse(localCache);
      } catch (e) {
        api.saveLocalSPVCache();
        api.electrumCache = {};
      }
    } else {
      api.saveLocalSPVCache();
      api.electrumCache = {};
    }
  };

  api.saveLocalSPVCache = () => {
    const spvCacheFileName = `${api.paths.agamaDir}/spv-cache.json`;

    _fs.access(api.paths.agamaDir, fs.constants.R_OK, (err) => {
      if (!err) {
        const FixFilePermissions = () => {
          return new Promise((resolve, reject) => {
            const result = 'spv-cache.json file permissions updated to Read/Write';

            fsnode.chmodSync(spvCacheFileName, '0600');

            setTimeout(() => {
              resolve(result);
            }, 1000);
          });
        }

        const FsWrite = () => {
          return new Promise((resolve, reject) => {
            const result = 'spv-cache.json write file is done';

            const err = fs.writeFileSync(spvCacheFileName,
                        JSON.stringify(api.electrumCache), 'utf8');

            if (err) return null;
            fsnode.chmodSync(spvCacheFileName, '0600');
            setTimeout(() => {
              resolve(result);
            }, 2000);
          });
        }

        FsWrite()
        .then(FixFilePermissions());
      }
    });
  }

  api.getTransaction = (txid, network, ecl) => {
    return new Promise((resolve, reject) => {
      if (!api.electrumCache[network]) {
        api.electrumCache[network] = {};
      }
      if (!api.electrumCache[network].tx) {
        api.electrumCache[network].tx = {};
      }
      if (!api.electrumCache[network].verboseTx) {
        api.electrumCache[network].verboseTx = {};
      }

      const _pendingTxFromCache = api.findPendingTxRawById(network.toUpperCase(), txid);
      
      if (_pendingTxFromCache) {
        resolve(_pendingTxFromCache);
      } else {
        if (api.electrum.coinData[network.toLowerCase()].nspv) {
          if (!api.electrumCache[network].tx[txid]) {
            const nspvWrapper = api.nspvWrapper(network.toLowerCase());

            nspvWrapper.blockchainTransactionGet(txid, true)
            .then((nspvGetTx) => {
              if (nspvGetTx &&
                  nspvGetTx.hasOwnProperty('hex')) {
                api.electrumCache[network].tx[txid] = nspvGetTx.hex;
                resolve(api.electrumCache[network].tx[txid]);
              } else {
                resolve();
              }
            });
          } else {
            resolve(api.electrumCache[network].tx[txid]);
          }
        } else {        
          if (!api.electrumCache[network].tx[txid] ||
              !api.electrumCache[network].verboseTx[txid] ||
              (api.electrumCache[network].verboseTx[txid] && api.electrumCache[network].verboseTx[txid].hasOwnProperty('confirmations') && api.electrumCache[network].verboseTx[txid].hasOwnProperty('rawconfirmations') && api.electrumCache[network].verboseTx[txid].confirmations < 2) ||
              (!api.electrumCache[network].verboseTx[txid].hasOwnProperty('confirmations') || !api.electrumCache[network].verboseTx[txid].hasOwnProperty('rawconfirmations'))) {
            
            ecl.blockchainTransactionGet(txid, api.dpowCoins.indexOf(network.toUpperCase()) > -1 ? true : false)
            .then((_rawtxJSON) => {
              if (_rawtxJSON.hasOwnProperty('hex')) {
                api.electrumCache[network].tx[txid] = _rawtxJSON.hex;
                api.electrumCache[network].verboseTx[txid] = _rawtxJSON;
                delete api.electrumCache[network].verboseTx[txid].hex;
              } else {
                api.electrumCache[network].tx[txid] = _rawtxJSON;
              }
              resolve(api.electrumCache[network].tx[txid]);
            });
          } else {
            resolve(api.electrumCache[network].tx[txid]);
          }
        }
      }
    });
  }

  api.getTransactionDecoded = (txid, network, data) => {
    if (!api.electrumCache[network].txDecoded) {
      api.electrumCache[network].txDecoded = {};
    }

    if (api.electrumCache[network].txDecoded[txid]) {
      return api.electrumCache[network].txDecoded[txid];
    } else {
      if (data) {
        api.electrumCache[network].txDecoded[txid] = data;
      } else {
        return false;
      }
    }
  }

  api.getBlockHeader = (height, network, ecl) => {
    return new Promise((resolve, reject) => {
      if (height === 'pending') {
        resolve({
          timestamp: Math.floor(Date.now() / 1000),
        });
      } else {
        if (!api.electrumCache[network]) {
          api.electrumCache[network] = {};
        }
        if (!api.electrumCache[network].blockHeader) {
          api.electrumCache[network].blockHeader = {};
        }        

        if (
          !api.electrumCache[network].blockHeader[height] ||
          !Object.keys(api.electrumCache[network].blockHeader[height]).length
        ) {
          ecl.blockchainBlockGetHeader(height).then((_rawtxJSON) => {
            if (typeof _rawtxJSON === "string") {
              _rawtxJSON = parseBlock(_rawtxJSON, btcnetworks[network] || btcnetworks.kmd);

              if (_rawtxJSON.merkleRoot) {
                _rawtxJSON.merkle_root = electrumMerkleRoot(_rawtxJSON);
              }
            }
            api.electrumCache[network].blockHeader[height] = _rawtxJSON;
            resolve(_rawtxJSON);
          });
        } else {
          resolve(api.electrumCache[network].blockHeader[height])
        }
      }
    });
  }

  return api;
};