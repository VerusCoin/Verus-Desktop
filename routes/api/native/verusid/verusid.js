module.exports = api => {
  api.native.verusid = {};
  api.native.verusid.login = {};
  api.native.verusid.provision = {};
  api.native.verusid.identity = {};
  api.native.verusid.generic = {};

  // Identity
  require('./identity/executeIdentityUpdateRequest')(api);

  // Login
  require('./login/verifyRequest')(api);
  require('./login/signResponse')(api);

  // Provisioning
  require('./provision/signIdProvisioningRequest')(api);
  require('./provision/verifyIdProvisioningResponse')(api);

  // Generic
  require('./generic/verifyGenericRequest')(api);
  require('./generic/signGenericResponse').default(api);
  require('./generic/executeAppEncryptionRequest').default(api);
  require('./generic/encryptAppEncryptionResponse').default(api);

  return api;
};
