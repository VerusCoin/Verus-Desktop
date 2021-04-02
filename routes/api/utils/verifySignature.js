const request = require('request');

// TODO: Implement when endpoint is complete
function verifyHash(hash, id, signature) {
  return new Promise((resolve, reject) => {  
    const options = {
      url: '',
      method: "POST",
      body: JSON.stringify({
        Hash: hash,
        Signature: signature,
        Identity: id
      })
    };

    request(options, (error, response, body) => {
      if (response &&
        response.statusCode &&
        response.statusCode === 200) {
        try {
          const _json = JSON.parse(body);

          resolve(true)
        } catch (e) {
          reject(e)
        }
      } else {
        reject(new Error(`Unable to request ${options.url}`))
      }
    });
  });
}

module.exports = {
  verifyHash
}