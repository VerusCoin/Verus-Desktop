const {
  IdentitySignature,
  networks,
} = require("@bitgo/utxo-lib");

module.exports = (api) => {
  /**
   * Gets the version, hashtype and height from a signature.
   * 
   * @param {String} coin The chainTicker of the coin to make the call on
   * @param {String} systemId The iaddress of the system
   * @param {String} signature The signature to process
   * @param {String} iaddress The iaddress associated with the signature
   */
  api.getSignatureInfo = (coin, systemId, signature, iaddress) => {

    const network = coin == "VRSC" ? networks.verus : networks.verustest;

    const sig = new IdentitySignature(network);

    sig.fromBuffer(Buffer.from(signature, "base64"), 0, systemId, iaddress);
    
    return {
      version: sig.version,
      hashtype: sig.hashType,
      height: sig.blockHeight,
    };
  }

  api.setPost('/lite/get_signature_info', (req, res, next) => {
    const {
      chainTicker,
      systemId,
      signature,
      iaddress
    } = req.body;

    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: api.getSignatureInfo(chainTicker, systemId, signature, iaddress),
        })
      );
    } catch (e) {
      res.send(
        JSON.stringify({
          msg: "error",
          result: e.message,
        })
      );
    }
  });

  return api;
}