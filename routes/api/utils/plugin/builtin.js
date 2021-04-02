const path = require('path')

const ReservedPluginTypes = {
  VERUS_DESKTOP_MAIN: "VERUS_DESKTOP_MAIN",
  VERUS_DESKTOP_AUTHENTICATOR: "VERUS_DESKTOP_AUTHENTICATOR"
}

// Builtin plugins have access to all permissions by default
const BuiltinPlugins = {
  [ReservedPluginTypes.VERUS_DESKTOP_MAIN]: {
    name: "Verus Desktop",
  },
  [ReservedPluginTypes.VERUS_DESKTOP_AUTHENTICATOR]: {
    name: "Authenticator",
    path: path.join(
      __dirname,
      "../",
      "../",
      "../",
      "../",
      "assets",
      "plugins",
      "builtin",
      "verus-desktop-authenticator"
    ),
  },
};

module.exports = {
  BuiltinPlugins,
  ReservedPluginTypes
}