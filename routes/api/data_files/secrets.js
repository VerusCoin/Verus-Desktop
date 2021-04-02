const { BUILTIN_SECRET, BUILTIN_SECRET_DESC } = require('../utils/constants/index')

module.exports = (api) => {
  api.loadBuiltinSecret = () => api.loadJsonFile(BUILTIN_SECRET, BUILTIN_SECRET_DESC, 0o600);
  api.saveBuiltinSecret = (secrets) => api.saveJsonFile(secrets, BUILTIN_SECRET, BUILTIN_SECRET_DESC, 0o600);

  return api;
};