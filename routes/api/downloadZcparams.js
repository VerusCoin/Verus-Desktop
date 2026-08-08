// ref: https://github.com/VerusCoin/Agama/blob/master/routes/shepherd/downloadZcparams.js

const fs = require('fs-extra');
const _fs = require('graceful-fs');
const zcashParamsSources = require('../zcashParamsSources')

// TODO: refactor into a loop

const fileSizes = {
  proving: 910173851,
  verifying: 1449,
  output: 3592860,
  spend: 47958396,
  groth16: 725523612,
};

module.exports = (api) => {
  api.zcashParamsExist = () => {
    let _checkList = {
      rootDir: _fs.existsSync(api.paths.zcashParamsDir),
      provingKey: _fs.existsSync(`${api.paths.zcashParamsDir}/sprout-proving.key`),
      provingKeySize: false,
      verifyingKey: _fs.existsSync(`${api.paths.zcashParamsDir}/sprout-verifying.key`),
      verifyingKeySize: false,
      spendKey: _fs.existsSync(`${api.paths.zcashParamsDir}/sapling-spend.params`),
      spendKeySize: false,
      outputKey: _fs.existsSync(`${api.paths.zcashParamsDir}/sapling-output.params`),
      outputKeySize: false,
      groth16Key: _fs.existsSync(`${api.paths.zcashParamsDir}/sprout-groth16.params`),
      groth16KeySize: false,
      errors: false,
    };

    if (_checkList.rootDir &&
        _checkList.provingKey ||
        _checkList.verifyingKey ||
        _checkList.spendKey ||
        _checkList.outputKey ||
        _checkList.groth16Key) {
      // verify each key size
      const _provingKeySize = _checkList.provingKey ? fs.lstatSync(`${api.paths.zcashParamsDir}/sprout-proving.key`) : 0;
      const _verifyingKeySize = _checkList.verifyingKey ? fs.lstatSync(`${api.paths.zcashParamsDir}/sprout-verifying.key`) : 0;
      const _spendKeySize = _checkList.spendKey ? fs.lstatSync(`${api.paths.zcashParamsDir}/sapling-spend.params`) : 0;
      const _outputKeySize = _checkList.outputKey ? fs.lstatSync(`${api.paths.zcashParamsDir}/sapling-output.params`) : 0;
      const _groth16KeySize = _checkList.groth16Key ? fs.lstatSync(`${api.paths.zcashParamsDir}/sprout-groth16.params`) : 0;
      
      if (Number(_provingKeySize.size) === fileSizes.proving) { // bytes
        _checkList.provingKeySize = true;
      }
      if (Number(_verifyingKeySize.size) === fileSizes.verifying) {
        _checkList.verifyingKeySize = true;
      }
      if (Number(_spendKeySize.size) === fileSizes.spend) {
        _checkList.spendKeySize = true;
      }
      if (Number(_outputKeySize.size) === fileSizes.output) {
        _checkList.outputKeySize = true;
      }
      if (Number(_groth16KeySize.size) === fileSizes.groth16) {
        _checkList.groth16KeySize = true;
      }

      api.log('zcashparams exist', 'native.zcashParams');
    } else {
      api.log('zcashparams doesnt exist', 'native.zcashParams');
    }

    if (!_checkList.rootDir ||
        !_checkList.provingKey ||
        !_checkList.verifyingKey ||
        !_checkList.provingKeySize ||
        !_checkList.verifyingKeySize ||
        !_checkList.spendKey ||
        !_checkList.outputKey ||
        !_checkList.groth16Key ||
        !_checkList.outputKeySize ||
        !_checkList.spendKeySize ||
        !_checkList.groth16KeySize) {
      _checkList.errors = true;
    }

    return _checkList;
  }

  api.zcashParamsExistPromise = () => {
    return new Promise((resolve, reject) => {
      const _verify = api.zcashParamsExist();
      resolve(_verify);
    });
  };

  /*
   *  Check bins
   *  type: POST
   *  params:
   */
  api.setPost('/zcashparamsexist', (req, res, next) => {
    api.zcashParamsExistPromise()
    .then(zcParamsExist => {
      res.send(JSON.stringify({
        msg: 'success',
        result: zcParamsExist
      }));
    })
    .catch(e => {
      res.send(JSON.stringify({
        msg: 'error',
        result: e.message
      }));
    })
  })

  /*
   *  Update bins
   *  type: POST
   *  params:
   */
  api.setPost('/zcparamsdl', (req, res, next) => {
    // const dlLocation = api.paths.zcashParamsDir + '/test';
    const dlLocation = api.paths.zcashParamsDir;
    const dlOption = req.body.dloption;
    const hasSelectedSource = typeof dlOption === 'string' &&
      Object.prototype.hasOwnProperty.call(zcashParamsSources, dlOption);

    if (!hasSelectedSource) {
      res.send(JSON.stringify({
        msg: 'error',
        result: 'Invalid Zcash parameters download source',
      }));
      return;
    }

    const selectedSource = zcashParamsSources[dlOption];
    const downloadKeys = Object.keys(selectedSource);
    const numFiles = downloadKeys.length;
    const initialCheckList = api.zcashParamsExist();
    const _keysProgress = downloadKeys.reduce((progress, key) => {
      progress[key] = 0;
      return progress;
    }, {});
    let downloadFailed = false;

    const successObj = {
      msg: 'success',
      result: 'zcash params dl started',
    };

    res.send(JSON.stringify(successObj));

    const checkProgress = () => {
      return Object.values(_keysProgress).reduce((a, b) => a + b, 0);
    };

    const markFileDone = (key) => {
      api.io.emit('zcparams', {
        msg: {
          type: 'zcpdownload',
          file: key,
          progress: 100,
          status: 'done',
        },
      });
      _keysProgress[key] = 100;

      if (!downloadFailed && checkProgress() === (numFiles * 100)) {
        api.io.emit('zcparams', {
          msg: {
            type: 'zcpdownload',
            file: 'all',
            progress: 100,
            status: 'done',
          },
        });
        api.log('zcash params downloaded', 'native.zcashParams');
      }

      api.log(`zcash params dl progress ${checkProgress() / numFiles}%`, 'native.zcashParams');
    };

    const markFileError = (key, message) => {
      downloadFailed = true;
      api.io.emit('zcparams', {
        msg: {
          type: 'zcpdownload',
          file: key,
          status: 'error',
          message,
          progress: _keysProgress[key],
        },
      });
      api.log(`${key} download failed: ${message}`, 'native.zcashParams');
    };

    for (let key of downloadKeys) {
      if (!initialCheckList[`${key}Key`] || !initialCheckList[`${key}KeySize`]) {
        let lastReportedProgress = 0;

        api.downloadFile({
          remoteFile: selectedSource[key],
          localFile: key === 'spend' || key === 'output' ? `${dlLocation}/sapling-${key}.params` : `${dlLocation}/sprout-${key}.params`,
          expectedBytes: fileSizes[key],
          onProgress: (received, total) => {
            if (!Number.isFinite(total) || total <= 0) return;

            const percentage = Math.min(99, Math.floor((received * 100) / total));
            if (!Number.isFinite(percentage) || percentage <= lastReportedProgress) return;

            lastReportedProgress = percentage;
            _keysProgress[key] = percentage;
            api.io.emit('zcparams', {
              msg: {
                type: 'zcpdownload',
                status: 'progress',
                file: key,
                bytesTotal: total,
                bytesReceived: received,
                progress: percentage,
              },
            });
          }
        })
        .then(() => {
          const checkZcashParams = api.zcashParamsExist();

          api.log(`${key} dl done, run size check`);

          if (!checkZcashParams[`${key}Key`] || !checkZcashParams[`${key}KeySize`]) {
            markFileError(key, 'size mismatch');
          } else {
            markFileDone(key);
            api.log(`file ${key} succesfully downloaded`, 'native.zcashParams');
          }
        })
        .catch((error) => {
          markFileError(key, error && error.message ? error.message : String(error));
        });
      } else {
        markFileDone(key);
        api.log('skip dl ' + key, 'native.zcashParams');
      }
    }
  });

  return api;
};
