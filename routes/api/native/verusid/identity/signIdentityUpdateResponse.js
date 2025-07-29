const {
  VerusIDSignature,
  IdentityUpdateResponse,
  LOGIN_CONSENT_RESPONSE_SIG_VDXF_KEY,
} = require("verus-typescript-primitives");

module.exports = (api) => {
  api.native.verusid.identity.sign_identity_update_response = async (coin, response) => {
    const identityUpdateResponse = IdentityUpdateResponse.fromJson(response);

    const signdataResult = await api.native.sign_data(coin,
      {
        "address": identityUpdateResponse.signingid.toAddress(),
        "datahash": identityUpdateResponse.details.toSha256().toString("hex")
      }
    )

    identityUpdateResponse.signature = new VerusIDSignature(
      { signature: signdataResult.signature },
      LOGIN_CONSENT_RESPONSE_SIG_VDXF_KEY
    );

    return { response: identityUpdateResponse.toJson()};
  };

  api.setPost("/native/verusid/identity/sign_identity_update_response", async (req, res, next) => {
    const { chainTicker, response } = req.body;

    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.verusid.identity.sign_identity_update_response(chainTicker, response),
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
