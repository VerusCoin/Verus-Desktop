const { assertSingleSignatureIdentity } = require("./identityUpdatePolicy");

module.exports = (api) => {  
  api.native.setidentitytimelock = async (chain, identity, lock) => {
    const idObj = await api.native.callDaemon(chain, "getidentity", [identity]);
    assertSingleSignatureIdentity(idObj && idObj.identity);
    return await api.native.callDaemon(chain, "setidentitytimelock", [identity, lock]);
  }

  api.setPost('/native/setidentitytimelock', async (req, res, next) => {
    const { chain, identity, lock } = req.body;

    try {
      res.send(
        JSON.stringify({
          msg: "success",
          result: await api.native.setidentitytimelock(chain, identity, lock),
        })
      );
    } catch (e) {
      res.send(JSON.stringify({
        msg: "error",
        result: e.message
      }));
    }
  });
    
  return api;
};
