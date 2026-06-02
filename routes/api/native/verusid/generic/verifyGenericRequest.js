const {GenericRequest} = require('verus-typescript-primitives');

module.exports = api => {
  /**
   * Verifies a generic request
   * @param {GenericRequest} Request
   */
  api.native.verusid.generic.verify_generic_request = async (coin, request) => {
    const verified = await api.native.verify_hash(
      coin,
      request.signature.identityID.toIAddress(),
      request.getRawDataSha256().toString('hex'),
      request.signature.signatureAsVch.toString('base64')
    );
    return verified ? {verified} : {verified, message: 'Failed to verify signature'};
  };

  api.setPost('/native/verusid/generic/verify_generic_request', async (req, res) => {
    const {chainTicker, request} = req.body;

    try {
      // The request is sent as a hex string of the buffer to avoid IPC serialization issues.
      const genericRequest = new GenericRequest();
      genericRequest.fromBuffer(Buffer.from(request, 'hex'));
      res.send(
        JSON.stringify({
          msg: 'success',
          result: await api.native.verusid.generic.verify_generic_request(
            chainTicker,
            genericRequest
          ),
        })
      );
    } catch (e) {
      res.send(
        JSON.stringify({
          msg: 'error',
          result: e.message,
        })
      );
    }
  });

  return api;
};
