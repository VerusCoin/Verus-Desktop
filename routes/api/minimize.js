module.exports = (api) => {
  api.setupMinimizeApis = (minimizeFunction) => {
    api.minimizeApp = minimizeFunction

    api.setPost('/plugin/minimize', async (req, res, next) => {
      try {
        api.minimizeApp()

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