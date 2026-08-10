const fs = require('fs-extra');
const passwdStrength = require('passwd-strength');
const bitcoin = require('bitgo-utxo-lib');
const deriveScalarFromSeed = require('./utils/auth/scalar');
const path = require("path");
const {
  assertAttemptAllowed,
  isValidPinFileName,
  recordFailedAttempt,
  resolvePinFile,
} = require("./utils/pinSecurity");
const {
  decryptPinPayload,
  encryptPinPayload,
  isIocanePayload,
  readPinFile,
  storeNewPinFile,
} = require("./utils/pinFile");
const { executeSensitiveReveal } = require("./sensitiveDataApproval");

module.exports = (api) => {
  api.pinDecryptAttempts = new Map();
  const pinDirectory = () => path.join(api.paths.agamaDir, "shepherd", "pin");

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
      const derivedPubkey = keyPair.getAddress();
      const pubkey = req.body.pubkey || derivedPubkey;

      if (passwdStrength(_pin) < 29) {
        api.log('seed storage weak pin!', 'pin');

        const retObj = {
          msg: 'error',
          result: 'Password is too weak, please try a stronger password',
        };

        res.send(JSON.stringify(retObj));
      } else {
        if (!isValidPinFileName(pubkey) || pubkey !== derivedPubkey) {
          return res.send(JSON.stringify({
            msg: 'error',
            result: 'Pin file name must match the encrypted seed',
          }));
        }

        try {
          const encryptedString = await encryptPinPayload(_str, _pin);
          const pinFile = resolvePinFile(pinDirectory(), pubkey);
          await storeNewPinFile(pinFile, encryptedString, _pin, _str);
          return res.send(JSON.stringify({ msg: 'success', result: pubkey }));
        } catch (error) {
          api.log(`Unable to save encrypted seed: ${error.message}`, 'pin');
          return res.send(JSON.stringify({
            msg: 'error',
            result: error.code === "PIN_FILE_EXISTS"
              ? error.message
              : 'Unable to safely save encrypted seed',
          }));
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
        if (!req.body[_paramsList[i]]) {
          _errorParamsList.push(_paramsList[i]);
        }
      }

      retObj.result = `missing param ${_errorParamsList.join(', ')}`;
      res.send(JSON.stringify(retObj));
    }
  }, true);

  api.setPost('/decryptkey', async (req, res, next) => {
    const _pubkey = req.body.pubkey;
    const _key = req.body.key;

    if (!_key || !_pubkey) {
      return res.send(JSON.stringify({ msg: "error", result: "Missing key or pubkey param" }));
    }

    let pinFile;
    try {
      pinFile = resolvePinFile(pinDirectory(), _pubkey);
      assertAttemptAllowed(api.pinDecryptAttempts, _pubkey);
    } catch (e) {
      return res.send(JSON.stringify({ msg: "error", result: e.message }));
    }

    if (!(await fs.pathExists(pinFile))) {
      recordFailedAttempt(api.pinDecryptAttempts, _pubkey);
      return res.send(JSON.stringify({ msg: "error", result: "Pin file not found" }));
    }

    let decryptedKey;
    try {
      let data = await readPinFile(pinFile);
      try {
        decryptedKey = await decryptPinPayload(data, _key);
      } catch (primaryError) {
        const backupFile = `${pinFile}.bak`;
        if (!(await fs.pathExists(backupFile)) || (await fs.lstat(backupFile)).isSymbolicLink()) {
          throw primaryError;
        }
        data = await readPinFile(backupFile);
        decryptedKey = await decryptPinPayload(data, _key);
        api.log(`pin ${_pubkey} recovered from its last-good backup`, "pin");
      }

      if (!isIocanePayload(data)) {
        // Legacy AES-CBC has no authentication tag. Validate the plaintext
        // against its historically derived filename when possible. The old
        // alphanumeric fallback remains for custom filenames supported by
        // previous releases.
        const { dBigi } = deriveScalarFromSeed(decryptedKey, { iguana: true });
        const derivedAddress = new bitcoin.ECPair(
          dBigi,
          null,
          { network: api.getNetworkData('btc') }
        ).getAddress();
        let isHistoricalDerivedFilename = false;
        try {
          isHistoricalDerivedFilename =
            bitcoin.address.fromBase58Check(_pubkey).version === api.getNetworkData('btc').pubKeyHash;
        } catch (error) {}
        if (derivedAddress !== _pubkey &&
            (isHistoricalDerivedFilename || !/^[0-9a-zA-Z ]+$/.test(decryptedKey))) {
          throw new Error("Legacy encrypted seed could not be authenticated");
        }
        api.log(`legacy encrypted seed read without modifying file ${_pubkey}`, "pin");
      }

      api.pinDecryptAttempts.delete(_pubkey);
      api.log(`pin ${_pubkey} decrypted`, "pin");
    } catch (e) {
      decryptedKey = null;
      recordFailedAttempt(api.pinDecryptAttempts, _pubkey);
      api.log(`pin ${_pubkey} decrypt err ${e.message}`, "pin");
      return res.send(JSON.stringify({ msg: "error", result: "Incorrect password." }));
    }

    try {
      const retObj = await executeSensitiveReveal(
        api,
        req,
        { kind: "seed", source: "pin", profile: _pubkey },
        async () => decryptedKey
      );
      return res.send(JSON.stringify(retObj));
    } finally {
      // JavaScript strings cannot be zeroed, but release this backend
      // reference immediately after the authorized response is constructed.
      decryptedKey = null;
    }
  }, true);

  return api;
};
