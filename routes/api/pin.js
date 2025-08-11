const fs = require('fs-extra');
const passwdStrength = require('passwd-strength');
const bitcoin = require('bitgo-utxo-lib');
const aes256 = require('nodejs-aes256');
const iocane = require('iocane');
const deriveScalarFromSeed = require('./utils/auth/scalar');
const session = iocane.createSession()
  .use('cbc')
  .setDerivationRounds(300000);

const encrypt = session.encrypt.bind(session);
const decrypt = session.decrypt.bind(session);

module.exports = (api) => {
  /*
   *  type: POST
   *  params: none
   */
  api.setPost('/encryptkey', async (req, res, next) => {
    const _pin = req.body.key;
    const _str = req.body.string;

    if (_pin && _str) {
      const { dBigi } = deriveScalarFromSeed(_str, {
        iguana: true,
        logWarn: (msg) => {
          api.alertMainWindow({
            title: "Private Key Warning!",
            message: msg,
            buttons: ["OK"],
            type: "warning",
          })
        }
      });

      const keyPair = new bitcoin.ECPair(dBigi, null, { network: api.getNetworkData('btc') });
      const keys = {
        pub: keyPair.getAddress(),
        priv: keyPair.toWIF(),
      };
      const pubkey = req.body.pubkey ? req.body.pubkey : keyPair.getAddress();

      if (passwdStrength(_pin) < 29) {
        api.log('seed storage weak pin!', 'pin');

        const retObj = {
          msg: 'error',
          result: 'Password is too weak, please try a stronger password',
        };

        res.send(JSON.stringify(retObj));
      } else {
        const _customPinFilenameTest = /^[0-9a-zA-Z-_]+$/g;

        if (_customPinFilenameTest.test(pubkey)) {
          encrypt(req.body.string, _pin)
          .then((encryptedString) => {
            fs.writeFile(`${api.paths.agamaDir}/shepherd/pin/${pubkey}.pin`, encryptedString, (err) => {
              if (err) {
                api.log('error writing pin file', 'pin');

                const retObj = {
                  msg: 'error',
                  result: 'Error writing pin file',
                };

                res.send(JSON.stringify(retObj));
              } else {
                const retObj = {
                  msg: 'success',
                  result: pubkey,
                };

                res.send(JSON.stringify(retObj));
              }
            });
          });
        } else {
          const retObj = {
            msg: 'error',
            result: 'pin file name can only contain alphanumeric characters, dash "-" and underscore "_"',
          };

          res.send(JSON.stringify(retObj));
        }
      }
    } else {
      const _paramsList = [
        'key',
        'string'
      ];
      let retObj = {
        msg: 'error',
        result: '',
      };
      let _errorParamsList = [];

      for (let i = 0; i < _paramsList.length; i++) {
        if (!req.query[_paramsList[i]]) {
          _errorParamsList.push(_paramsList[i]);
        }
      }

      retObj.result = `missing param ${_errorParamsList.join(', ')}`;
      res.send(JSON.stringify(retObj));
    }
  }, true);

  api.setPost('/decryptkey', (req, res, next) => {
    const _pubkey = req.body.pubkey;
    const _key = req.body.key;

    if (_key &&
        _pubkey) {
      if (fs.existsSync(`${api.paths.agamaDir}/shepherd/pin/${_pubkey}.pin`)) {
        fs.readFile(`${api.paths.agamaDir}/shepherd/pin/${_pubkey}.pin`, 'utf8', async(err, data) => {
          if (err) {
            const retObj = {
              msg: 'error',
              result: err,
            };

            res.send(JSON.stringify(retObj));
          } else {
            const decryptedKey = aes256.decrypt(_key, data);
            const _regexTest = decryptedKey.match(/^[0-9a-zA-Z ]+$/g);

            if (_regexTest) { // re-encrypt with a new method
              encrypt(decryptedKey, _key)
              .then((encryptedString) => {
                api.log(`seed encrypt old method detected for file ${_pubkey}`, 'pin');

                fs.writeFile(`${api.paths.agamaDir}/shepherd/pin/${_pubkey}.pin`, encryptedString, (err) => {
                  if (err) {
                    api.log(`Error re-encrypt pin file ${_pubkey}`, 'pin');

                    const retObj = {
                      msg: 'error',
                      result: `Error re-encrypt pin file ${_pubkey}`
                    };

                    res.send(JSON.stringify(retObj));
                  } else {
                    const retObj = {
                      msg: 'success',
                      result: decryptedKey,
                    };

                    res.send(JSON.stringify(retObj));
                  }
                });
              });
            } else {
              decrypt(data, _key)
              .then((decryptedKey) => {
                api.log(`pin ${_pubkey} decrypted`, 'pin');

                const retObj = {
                  msg: 'success',
                  result: decryptedKey,
                };

                res.send(JSON.stringify(retObj));
              })
              .catch((err) => {
                api.log(`pin ${_pubkey} decrypt err ${err}`, 'pin');

                const retObj = {
                  msg: 'error',
                  result: 'Incorrect password.',
                };

                res.send(JSON.stringify(retObj));
              });
            }
          }
        });
      } else {
        const retObj = {
          msg: 'error',
          result: `File ${_pubkey}.pin doesnt exist`,
        };

        res.send(JSON.stringify(retObj));
      }
    } else {
      const retObj = {
        msg: 'error',
        result: 'Missing key or pubkey param',
      };

      res.send(JSON.stringify(retObj));
    }
  }, true);

  return api;
};