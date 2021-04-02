module.exports = (api) => {
  api.setupFocusApis = (focusFunction) => {
    api.focusApp = focusFunction

    api.setPost('/plugin/focus', async (req, res, next) => {
      try {
        api.focusApp()

        res.send(JSON.stringify({
          msg: 'success'
        }))
      } catch(e) {
        res.send(JSON.stringify({
          msg: 'error',
          error: e.message
        }))
      }
    });
  }

  return api;
};