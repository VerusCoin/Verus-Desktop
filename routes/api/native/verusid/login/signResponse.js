const {
  VerusIDSignature,
  LoginConsentResponse,
  LOGIN_CONSENT_RESPONSE_SIG_VDXF_KEY,
} = require("verus-typescript-primitives");

module.exports = (api) => {
  api.native.verusid.login.sign_response = async (response) => {
    const loginResponse = new LoginConsentResponse(response);
    const chainTicker = response.chainTicker
    // Add the chainTicker when checking the request since the verify request needs it.
    let decisionRequest = loginResponse.decision.request
    decisionRequest.chainTicker = chainTicker

    const verificatonCheck = await api.native.verusid.login.verify_request(
      decisionRequest
    );

    if (!verificatonCheck.verified) {
      throw new Error(verificatonCheck.message);
    }

    const signdataResult = await api.native.sign_data(chainTicker,
      {
        "address": loginResponse.signing_id,
        "datahash": loginResponse.decision.toSha256().toString("hex")
      }
    )

    loginResponse.signature = new VerusIDSignature(
      { signature: signdataResult.signature },
      LOGIN_CONSENT_RESPONSE_SIG_VDXF_KEY
    );

    // Remove the chainTicker field since it's not normally part of the response.
    delete decisionRequest.chainTicker

    return { response: loginResponse};
  };

  api.setPost("/native/verusid/login/sign_response", async (req, res, next) => {
    const { response } = req.body;

    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.verusid.login.sign_response(response),
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
