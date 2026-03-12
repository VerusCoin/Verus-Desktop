const {
  GENERIC_REQUEST_DEEPLINK_VDXF_KEY,
  GenericRequest,
  LOGIN_CONSENT_REQUEST_VDXF_KEY,
  LoginConsentRequest,
} = require('verus-typescript-primitives');
const {ROOT_SYSTEM_NAME} = require('./utils/constants/dev_options');
const {SUPPORTED_V1_DLS, CALLBACK_HOST} = require('./utils/constants/supported_dls');

module.exports = api => {
  api.dlhandler = urlstring => {
    const deeplinkHandler = urlstring => {
      const url = new URL(urlstring);

      let id;
      let data;

      // Handle v1 and v2 requests separately.
      if (url.host === CALLBACK_HOST) {
        id = url.pathname.split('/')[1];

        if (!SUPPORTED_V1_DLS.includes(id)) {
          throw new Error('Unsupported deeplink url path.');
        }

        let dl;
        switch (id) {
          case LOGIN_CONSENT_REQUEST_VDXF_KEY.vdxfid:
            dl = LoginConsentRequest.fromWalletDeeplinkUri(urlstring);
            break;
          default:
            throw new Error(`Unsupported deeplink ID: ${urlstring}`);
        }
        data = dl.toJson();
      } else {
        const req = GenericRequest.fromWalletDeeplinkUri(urlstring);
        id = GENERIC_REQUEST_DEEPLINK_VDXF_KEY.vdxfid;
        // Send the request as a QR string so it's properly serialized.
        // If the buffer is sent directly, the IPC converts it to a JSON object and increases
        // the size of the payload.
        data = req.toQrString();
      }

      return api.loginConsentUi.deeplink(
        {
          id: id,
          data: data,
        },
        {
          id: 'VERUS_DESKTOP_MAIN',
          search_builtin: true,
          main_chain_ticker: ROOT_SYSTEM_NAME,
        }
      );
    };

    return deeplinkHandler(urlstring);
  };

  return api;
};
