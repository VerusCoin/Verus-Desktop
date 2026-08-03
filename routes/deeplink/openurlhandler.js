const { dialog } = require('electron')

function openurlhandler(event, urlstring, apihandler) {
  try {
    return apihandler(urlstring);
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