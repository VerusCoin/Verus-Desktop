const { WALLET_VDXF_KEY } = require("verus-typescript-primitives")

function removelink(app) {
  const protocols = [WALLET_VDXF_KEY.vdxfid, 'verus'];
  const results = [];

  for (const protocol of protocols) {
    const res = app.removeAsDefaultProtocolClient(protocol);
    results.push({ protocol, success: res });
  }

  return results;
}

module.exports = removelink