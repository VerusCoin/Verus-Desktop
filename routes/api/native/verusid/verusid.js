module.exports = (api) => {
  api.native.verusid = {}
  api.native.verusid.login = {}
  api.native.verusid.provision = {}
  api.native.verusid.identity = {}

  // Identity
  require('./identity/verifyIdentityUpdateRequest')(api);
  
  // Login
  require('./login/verifyRequest')(api);
  require('./login/signResponse')(api);
  
  // Provisioning
  require('./provision/signIdProvisioningRequest')(api);
  require('./provision/verifyIdProvisioningResponse')(api);

  return api;
};
