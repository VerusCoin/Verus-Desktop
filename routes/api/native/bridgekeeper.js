const { requestJson } = require('../utils/request/request');

module.exports = (api) => {
  const bridge_Keeper_url = ""
  api.setPost('/native/bridge_keeper', async (req, res, next) => {
    try {
      const res = await requestJson(
        "GET",
        bridge_Keeper_url
      )
      if(res) {
        res.send({
          msg: 'success'
        })
      }
    } catch (error) {
      res.status(400).send({
        msg: 'error',
        result: error
      })
    }
  })
}