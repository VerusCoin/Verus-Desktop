"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  PACKAGED_DEBUG_SWITCHES,
  hardenPackagedDebugging,
  hasDevelopmentArgument,
  isDevToolsShortcut,
  resolveDevelopmentMode,
} = require("../routes/security/runtimeMode");

describe("packaged runtime hardening", function () {
  it("never enables development mode in a packaged application", function () {
    for (const argv of [[], ["devmode"], ["--devmode"], ["unrelated-devmode"]]) {
      assert.strictEqual(
        resolveDevelopmentMode({ isPackaged: true, configDev: true, argv }),
        false
      );
    }
  });

  it("accepts only exact development arguments in an unpackaged application", function () {
    assert.strictEqual(hasDevelopmentArgument(["devmode"]), true);
    assert.strictEqual(hasDevelopmentArgument(["--devmode"]), true);
    assert.strictEqual(hasDevelopmentArgument(["node", "devmode=1"]), false);
    assert.strictEqual(hasDevelopmentArgument(["node", "/tmp/devmode"]), false);
    assert.strictEqual(
      resolveDevelopmentMode({ isPackaged: false, configDev: false, argv: ["--devmode"] }),
      true
    );
  });

  it("removes packaged debugger switches and closes the Node inspector", function () {
    const removed = [];
    let inspectorClosed = 0;
    const hardened = hardenPackagedDebugging(
      {
        isPackaged: true,
        commandLine: { removeSwitch(name) { removed.push(name); } },
      },
      { close() { inspectorClosed += 1; } }
    );

    assert.strictEqual(hardened, true);
    assert.deepStrictEqual(removed, [...PACKAGED_DEBUG_SWITCHES]);
    assert.strictEqual(inspectorClosed, 1);
  });

  it("recognizes the standard DevTools keyboard shortcuts", function () {
    assert.strictEqual(isDevToolsShortcut({ type: "keyDown", key: "F12" }), true);
    assert.strictEqual(
      isDevToolsShortcut({ type: "keyDown", key: "I", shift: true, control: true }),
      true
    );
    assert.strictEqual(
      isDevToolsShortcut({ type: "keyDown", key: "i", shift: true, meta: true }),
      true
    );
    assert.strictEqual(
      isDevToolsShortcut({ type: "keyDown", key: "i", control: true }),
      false
    );
  });

  it("uses the centralized mode decision for every production renderer", function () {
    const root = path.resolve(__dirname, "..");
    const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
    const plugins = fs.readFileSync(path.join(root, "routes/api/plugin/start.js"), "utf8");
    const menu = fs.readFileSync(path.join(root, "private/mainmenu.js"), "utf8");

    assert.doesNotMatch(main, /indexOf\(["']devmode["']\)/);
    assert.doesNotMatch(plugins, /indexOf\(["']devmode["']\)/);
    assert.match(main, /devTools: isDevMode/g);
    assert.match(plugins, /devTools: api\.isDevMode === true/);
    assert.match(menu, /api\.isDevMode === true/);
  });

  it("serves packaged built-ins from the authenticated loopback origin", function () {
    const root = path.resolve(__dirname, "..");
    const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
    const builtinPreload = fs.readFileSync(
      path.join(root, "routes", "preloads", "plugin", "preload-builtin.js"),
      "utf8"
    );
    const { packagedBuiltinUrl } = require("../routes/api/plugin/start");
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verus-builtins-"));
    const loginRoot = path.join(temporaryRoot, "verus-login-consent-client");
    fs.mkdirSync(loginRoot);
    const loginIndex = path.join(
      loginRoot,
      "index.html"
    );
    fs.writeFileSync(loginIndex, "<!doctype html>");

    try {
      assert.strictEqual(
        packagedBuiltinUrl(loginIndex, 17775, temporaryRoot),
        "http://127.0.0.1:17775/builtin/verus-login-consent-client/index.html"
      );
      assert.throws(
        () => packagedBuiltinUrl(path.join(root, "package.json"), 17775, temporaryRoot),
        /escapes the reviewed plugin directory/
      );
      assert.throws(
        () => packagedBuiltinUrl(loginIndex, "17775", temporaryRoot),
        /port is invalid/
      );

      fs.symlinkSync(path.join(root, "package.json"), path.join(loginRoot, "linked.js"));
      assert.throws(
        () => packagedBuiltinUrl(loginIndex, 17775, temporaryRoot),
        /must not contain symbolic links/
      );
      assert.match(
        main,
        /guiapp\.use\(\s*"\/builtin",\s*createContentSecurityPolicyMiddleware[\s\S]*?express\.static\(builtinPluginPath/
      );
      assert.match(
        builtinPreload,
        /window\.postMessage\(JSON\.stringify\(msg\), window\.location\.origin\)/
      );
      assert.doesNotMatch(
        builtinPreload,
        /window\.postMessage\(JSON\.stringify\(msg\), ['"]\*['"]\)/
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("prevents a packaged built-in from navigating its privileged preload", function () {
    const { installPackagedNavigationGuard } = require("../routes/api/plugin/start");
    const listeners = {};
    let openHandler;
    let auditCount = 0;
    const webContents = {
      on(event, listener) { listeners[event] = listener; },
      setWindowOpenHandler(handler) { openHandler = handler; },
    };
    const expected =
      "http://127.0.0.1:17775/builtin/verus-login-consent-client/index.html";
    installPackagedNavigationGuard(webContents, expected, () => { auditCount += 1; });

    const allowedEvent = { prevented: false, preventDefault() { this.prevented = true; } };
    listeners["will-navigate"](allowedEvent, expected);
    assert.strictEqual(allowedEvent.prevented, false);

    for (const target of [
      "https://attacker.example/",
      "data:text/html,owned",
      "file:///tmp/owned.html",
      "http://127.0.0.1:17775/builtin/verus-pbaas-visualizer/index.html",
    ]) {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      listeners["will-navigate"](event, target);
      assert.strictEqual(event.prevented, true, target);
    }
    const popupEvent = { prevented: false, preventDefault() { this.prevented = true; } };
    listeners["new-window"](popupEvent);
    assert.strictEqual(popupEvent.prevented, true);
    assert.deepStrictEqual(openHandler({ url: "https://attacker.example/" }), { action: "deny" });
    assert.strictEqual(auditCount, 5);
  });

  it("preserves every open window for the same plugin", function () {
    const { registerPluginWindow } = require("../routes/api/plugin/start");
    const windows = { builtin: {}, registry: {} };
    const completions = { builtin: {}, registry: {} };
    const firstWindow = { id: 11 };
    const secondWindow = { id: 12 };
    const firstComplete = () => {};
    const secondComplete = () => {};

    registerPluginWindow(
      windows,
      completions,
      "builtin",
      "VERUS_LOGIN_CONSENT_UI",
      firstWindow,
      firstComplete
    );
    registerPluginWindow(
      windows,
      completions,
      "builtin",
      "VERUS_LOGIN_CONSENT_UI",
      secondWindow,
      secondComplete
    );

    assert.deepStrictEqual(
      windows.builtin.VERUS_LOGIN_CONSENT_UI,
      { 11: firstWindow, 12: secondWindow }
    );
    assert.deepStrictEqual(
      completions.builtin.VERUS_LOGIN_CONSENT_UI,
      { 11: firstComplete, 12: secondComplete }
    );
  });
});
