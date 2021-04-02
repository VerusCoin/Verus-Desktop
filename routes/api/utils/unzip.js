const fs = require('fs')
const unzip = require('unzipper')

function unzipFile(input, output) {
  return new Promise((resolve, reject) => {
    try {
      const s = fs.createReadStream(input)

      const pipe = s.pipe(unzip.Extract({ path: output }))

      pipe.on('close', function () {
        return resolve();
      })
      
      pipe.on('error', function(error) {
        s.destroy(error)
        return reject(error)
      });
    } catch (error) {
      return reject(error);
    }
  });
}

module.exports = {
  unzipFile
}