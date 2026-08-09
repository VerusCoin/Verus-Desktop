const fs = require('fs-extra');
const http = require('http')
const https = require('https')
const { Transform, pipeline } = require('stream')
const axios = require('axios')

module.exports = (api) => {
  /**
   * Promise based download file method
   */
  api.downloadFile = async (configuration) => {
    let receivedBytes = 0;
    const httpAgent = new http.Agent({ keepAlive: true });
    const httpsAgent = new https.Agent({ keepAlive: true });

    try {
      const response = await axios({
        method: 'get',
        url: configuration.remoteFile,
        responseType: 'stream',
        httpAgent,
        httpsAgent,
      })
      const parsedTotalBytes = Number.parseInt(response.headers['content-length'], 10);
      const configuredTotalBytes = Number(configuration.expectedBytes);
      let totalBytes = 0;

      if (Number.isFinite(parsedTotalBytes) && parsedTotalBytes > 0) {
        totalBytes = parsedTotalBytes;
      } else if (Number.isFinite(configuredTotalBytes) && configuredTotalBytes > 0) {
        totalBytes = configuredTotalBytes;
      }
      const progressStream = new Transform({
        transform(chunk, encoding, callback) {
          receivedBytes += chunk.length;

          if (typeof configuration.onProgress === 'function') {
            try {
              configuration.onProgress(receivedBytes, totalBytes);
            } catch (error) {
              callback(error);
              return;
            }
          }

          callback(null, chunk);
        },
      });

      await new Promise((resolve, reject) => {
        pipeline(
          response.data,
          progressStream,
          fs.createWriteStream(configuration.localFile),
          (error) => error ? reject(error) : resolve()
        );
      });
    } finally {
      httpAgent.destroy();
      httpsAgent.destroy();
    }
  }

  return api;
};
