const {GenericRequest, GENERIC_REQUEST_VDXF_KEY} = require("verus-typescript-primitives")

// Time difference threshold in seconds (5 minutes)
const LOGIN_CONSENT_SIG_TIME_DIFF_THRESHOLD = 300;

module.exports = (api) => {
  /**
   * Verifies a generic request
   * TODO: FIX THIS WHEN THE PROBLEM IS UNDERSTOOD
   * @param {GenericRequest} Request
   */
  api.native.verusid.generic.verify_generic_request = async (coin, request) => {
    console.log("Verifying Generic Request:", request);
    console.log("Coin", coin);
    console.log("Identity ID:", request.signature.identityID.address);
    console.log("Raw Data SHA256:", request.getRawDataSha256(false).toString('hex'))
    console.log("Signature:", request.signature.signatureAsVch.toString('base64'))

    const verifiableSig = request.signature;
    const chainIAddr = request.signature.systemID.address;

    // Get signature info to extract block height
    const sigInfo = api.getSignatureInfo(
      coin,
      verifiableSig.systemID.address,
      verifiableSig.signatureAsVch.toString('base64'),
      verifiableSig.identityID.address
    );

    /*
    // Validate timestamp if present
    if (request.hasCreatedAt()) {
      // Get block time from the signature height
      const blockRes = await api.native.get_block(coin, sigInfo.height.toString());
      
      if (blockRes.error) {
        throw new Error(blockRes.error.message);
      }

      const blocktime = blockRes.result.time;

      // Check if time difference is within threshold
      if (Math.abs(blocktime - request.createdAt.toNumber()) > LOGIN_CONSENT_SIG_TIME_DIFF_THRESHOLD) {
        return { verified: false, message: "Signature timestamp outside acceptable range" };
      }
    } else {
      return { verified: false, message: "Missing createdAt timestamp" };
    }
      */

    // Verify the hash with identity signature
    const verified = await api.native.verify_hash(
      coin,
      verifiableSig.identityID.address,
      request.getDetailsIdentitySignatureHash(sigInfo.height).toString('hex'),
      verifiableSig.signatureAsVch.toString('base64'),
    );

    return verified ? { verified } : { verified, message: "Failed to verify signature" };
  };

  api.setPost("/native/verusid/generic/verify_generic_request", async (req, res, next) => {
    const { chainTicker, request } = req.body;
    // The request is sent as a QR string to avoid IPC serialization issues.
    const genericRequest = GenericRequest.fromQrString(request);

    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.verusid.generic.verify_generic_request(chainTicker, genericRequest),
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
};
