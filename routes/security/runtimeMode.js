"use strict";

const DEVELOPMENT_ARGUMENTS = new Set(["devmode", "--devmode"]);
const PACKAGED_DEBUG_SWITCHES = Object.freeze([
  "inspect",
  "inspect-brk",
  "remote-debugging-port",
  "remote-debugging-pipe",
]);

const hasDevelopmentArgument = (argv) =>
  Array.isArray(argv) && argv.some((argument) => DEVELOPMENT_ARGUMENTS.has(argument));

const resolveDevelopmentMode = ({ isPackaged, configDev, argv } = {}) =>
  isPackaged !== true && (configDev === true || hasDevelopmentArgument(argv));

const hardenPackagedDebugging = (app, inspectorApi) => {
  if (!app || app.isPackaged !== true) return false;

  if (app.commandLine && typeof app.commandLine.removeSwitch === "function") {
    for (const name of PACKAGED_DEBUG_SWITCHES) app.commandLine.removeSwitch(name);
  }
  if (inspectorApi && typeof inspectorApi.close === "function") {
    try {
      inspectorApi.close();
    } catch (error) {
      // The inspector was not active or could not be closed. Renderer
      // DevTools remain disabled independently through webPreferences.
    }
  }
  return true;
};

const isDevToolsShortcut = (input) => {
  if (!input || input.type !== "keyDown") return false;
  const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
  return key === "f12" || (
    key === "i" && input.shift === true && (input.control === true || input.meta === true)
  );
};

module.exports = {
  PACKAGED_DEBUG_SWITCHES,
  hardenPackagedDebugging,
  hasDevelopmentArgument,
  isDevToolsShortcut,
  resolveDevelopmentMode,
};
