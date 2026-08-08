const axios = require('axios');
const {
  LOGIN_CONSENT_RESPONSE_VDXF_KEY,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
  LOGIN_CONSENT_REDIRECT_VDXF_KEY,
  LoginConsentResponse,
} = require("verus-typescript-primitives");
const { pushMessage } = require('../../../ipc/ipc');
const { ReservedPluginTypes } = require('../../utils/plugin/builtin');
const { shell } = require('electron');
const base64url = require('base64url');
const {
  bindRedirectToRequest,
  createWebhookRequestConfig,
  parseBrowserRedirectUrl,
  postWebhookWithDeadline,
  snapshotRequestRedirects,
} = require('../../utils/loginConsentSecurity');

module.exports = (api, dependencies = {}) => {
  const httpClient = dependencies.httpClient || axios;
  const externalShell = dependencies.shell || shell;
  const lookup = dependencies.lookup;

  api.loginConsentUi = {}

  api.loginConsentUi.handle_redirect = async (response, redirectinfo) => {
    const { vdxfkey, uri } = redirectinfo

    const handlers = new Map([
      [LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid, async () => {
        const { url, config } = await createWebhookRequestConfig(uri, { lookup });
        await postWebhookWithDeadline(httpClient, url, response, config);
        return null;
      }],
      [LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid, async () => {
        const url = parseBrowserRedirectUrl(uri);

        const res = new LoginConsentResponse(response)
        url.searchParams.set(
          LOGIN_CONSENT_RESPONSE_VDXF_KEY.vdxfid,
          base64url(res.toBuffer())
        );
        
        await externalShell.openExternal(url.toString())
        return null
      }],
    ]);

    const handler = handlers.get(vdxfkey);
    if (handler == null) {
      throw new Error("Unsupported login consent redirect type");
    }

    return handler();
  }

  api.loginConsentUi.request = async (
    request,
    originInfo
  ) => {
    return new Promise((resolve, reject) => {
      try {
        const requestRedirects = snapshotRequestRedirects(request);

        const pluginStart = api.startPlugin(
          ReservedPluginTypes.VERUS_LOGIN_CONSENT_UI,
          true,
          async (data) => {
            try {
              if (data.redirect) {
                const boundRedirect = bindRedirectToRequest(data.redirect, requestRedirects);
                await api.loginConsentUi.handle_redirect(data.response, boundRedirect);
              }

              resolve(data.response);
            } catch(e) {
              reject(e)
            }
          },
          (pluginWindow) => {
            pushMessage(
              pluginWindow,
              {
                request: request,
                origin_app_info: originInfo,
              },
              "VERUS_LOGIN_CONSENT_REQUEST"
            );
          },
          830,
          550,
          false
        );

        Promise.resolve(pluginStart).catch(reject);
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
        result: await api.loginConsentUi.request(
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
