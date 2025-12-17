const path = require('path')
const { WALLET_VDXF_KEY } = require('verus-typescript-primitives');

function setuplink(app) {
  const protocols = [WALLET_VDXF_KEY.vdxfid, 'verus'];
  const results = [];

  for (const protocol of protocols) {
    let res;
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        res = app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])])
      }
    } else {
      res = app.setAsDefaultProtocolClient(protocol)
    }
    results.push({ protocol, success: res });
  }

  return results;
}

module.exports = setuplink