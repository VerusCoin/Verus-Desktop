const { dialog } = require('electron')
const { URL } = require('url');
const { SUPPORTED_DLS, CALLBACK_HOST } = require('../api/utils/constants/supported_dls');

function openurlhandler(event, urlstring, apihandler) {
  try {
    const url = new URL(urlstring);

    if (url.host !== CALLBACK_HOST) throw new Error("Unsupported host url.");
    if (!SUPPORTED_DLS.includes(url.pathname.replace(/\//g, "")))
      throw new Error("Unsupported url path.");

    return apihandler(url);
  } catch (e) {
    setTimeout(() => {
      // This avoids crashing 20 seconds after the error box has been left open.
      dialog.showErrorBox(
        "Something went wrong?",
        `Error: "${e.message}". For url string: "${urlstring}".`
      );
    }, 0);
  }
}

module.exports = openurlhandler