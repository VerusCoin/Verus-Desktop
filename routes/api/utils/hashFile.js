const crypto = require('crypto'), fs = require('fs')

function hashFile(filename, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    let crypto_hash = crypto.createHash(algorithm);

    try {
      let stream = fs.ReadStream(filename)

      stream.on('data', function (data) {
        crypto_hash.update(data)
      })

      stream.on('end', function () {
        const hash = crypto_hash.digest('hex')
        return resolve(hash);
      })

    } catch (error) {
      return reject(error);
    }
  });
}

module.exports = {
  hashFile
}