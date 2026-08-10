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
    let pendingClaim = null;

    try {
      if (req.api_header && req.api_header.app_id === "VERUS_LOGIN_CONSENT_UI") {
        if (
          api.loginConsentUi == null ||
          typeof api.loginConsentUi.beginPendingResponse !== "function"
        ) {
          throw new Error("Login-consent session validation is unavailable");
        }
        pendingClaim = api.loginConsentUi.beginPendingResponse(response);
      }
      const signedResponse = await api.native.verusid.login.sign_response(response);
      if (pendingClaim != null) pendingClaim.consume();
      res.send(
        JSON.stringify({
          msg: "success",
          result: signedResponse,
        })
      );
    } catch (e) {
      if (pendingClaim != null) pendingClaim.release();
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
