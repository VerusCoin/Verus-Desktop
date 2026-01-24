module.exports = (api) => {
  api.native.verusid = {}
  api.native.verusid.login = {}
  api.native.verusid.provision = {}
  api.native.verusid.identity = {}
  api.native.verusid.generic = {}

  // Identity
  require('./identity/verifyIdentityUpdateRequest')(api);
  require('./identity/executeIdentityUpdateRequest')(api);
  require('./identity/signIdentityUpdateResponse')(api);
  
  // Login
  require('./login/verifyRequest')(api);
  require('./login/signResponse')(api);
  
  // Provisioning
  require('./provision/signIdProvisioningRequest')(api);
  require('./provision/verifyIdProvisioningResponse')(api);

  // Generic
  require('./generic/verifyGenericRequest')(api);
  require('./generic/signGenericResponse').default(api);

  return api;
};
