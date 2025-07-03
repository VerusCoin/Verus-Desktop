const axios = require('axios');
const {
  LOGIN_CONSENT_RESPONSE_VDXF_KEY,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
  LOGIN_CONSENT_REDIRECT_VDXF_KEY,
  LoginConsentResponse,
} = require("verus-typescript-primitives");
const { pushMessage } = require('../../../ipc/ipc');
const { ReservedPluginTypes } = require('../../utils/plugin/builtin');
const { shell } = require('electron')
const { URL } = require('url');
const base64url = require('base64url');

module.exports = (api) => {
  api.loginConsentUi = {}

  api.loginConsentUi.handle_redirect = (response, redirectinfo) => {
    const { vdxfkey, uri } = redirectinfo

    const handlers = {
      [LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid]: async () => {
        return await axios.post(
          uri,
          response
        );
      },
      [LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid]: () => {
        const url = new URL(uri)

        // Prevent opening any urls that don't go to the browser.
        if (!['https:', 'http:'].includes(url.protocol)) {
          return null;
        } 

        const res = new LoginConsentResponse(response)
        url.searchParams.set(
          LOGIN_CONSENT_RESPONSE_VDXF_KEY.vdxfid,
          base64url(res.toBuffer())
        );
        
        shell.openExternal(url.toString())
        return null
      }
    }

    return handlers[vdxfkey] == null ? null : handlers[vdxfkey]();
  }

  api.loginConsentUi.deeplink = async (
    deeplink,
    originInfo
  ) => {
    return new Promise((resolve, reject) => {
      try {
        api.startPlugin(
          ReservedPluginTypes.VERUS_LOGIN_CONSENT_UI,
          true,
          (data) => {
            try {
              if (data.redirect) api.loginConsentUi.handle_redirect(data.response, data.redirect);

              resolve(data.response);
            } catch(e) {
              reject(e)
            }
          },
          (pluginWindow) => {
            pushMessage(
              pluginWindow,
              {
                deeplink: deeplink,
                origin_app_info: originInfo,
              },
              "VERUS_LOGIN_CONSENT_REQUEST"
            );
          },
          830,
          550,
          false
        );
      } catch (e) {
        reject(e);
      }
    });
  };

  api.setPost('/plugin/builtin/verus_login_consent_ui/request', async (req, res, next) => {
    const { request } = req.body;
    const { app_id, builtin } = req.api_header
   
    try {
      const retObj = {
        msg: "success",
        result: await api.loginConsentUi.deeplink(
          request,
          {
            id: app_id,
            search_builtin: builtin,
          }
        ),
      };

      res.send(JSON.stringify(retObj));
    } catch (e) {
      const retObj = {
        msg: 'error',
        result: e.message,
      };

      res.send(JSON.stringify(retObj));
    }
  });

  return api;
};