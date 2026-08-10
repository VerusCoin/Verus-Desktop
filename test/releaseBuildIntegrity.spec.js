const assert = require("assert");
const crypto = require("crypto");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const {
  writeArtifactChecksum,
} = require("../scripts/writeArtifactChecksums");

const projectRoot = path.resolve(__dirname, "..");

describe("release build integrity", function () {
  it("writes a deterministic SHA-256 sidecar for a release artifact", async function () {
    const temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "verus-artifact-hash-")
    );
    const artifactPath = path.join(temporaryDirectory, "Verus-Desktop.test");
    const contents = Buffer.from("deterministic release artifact\n", "utf8");

    try {
      await fs.promises.writeFile(artifactPath, contents);
      const first = await writeArtifactChecksum(artifactPath);
      const firstManifest = await fs.promises.readFile(first.checksumPath, "utf8");
      const second = await writeArtifactChecksum(artifactPath);
      const secondManifest = await fs.promises.readFile(second.checksumPath, "utf8");
      const expectedDigest = crypto.createHash("sha256").update(contents).digest("hex");

      assert.strictEqual(first.digest, expectedDigest);
      assert.strictEqual(second.digest, expectedDigest);
      assert.strictEqual(firstManifest, `${expectedDigest}  Verus-Desktop.test\n`);
      assert.strictEqual(secondManifest, firstManifest);
    } finally {
      await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects unsafe built-in renderer output before packaging", async function () {
    const temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "verus-builtin-output-test-")
    );
    const buildDirectory = path.join(temporaryDirectory, "build");
    const indexPath = path.join(buildDirectory, "index.html");
    const appPath = path.join(buildDirectory, "app.js");
    const builderPath = path.join(projectRoot, "scripts", "buildBuiltinPlugins.sh");
    const validIndex =
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; connect-src \'self\'; object-src \'none\'">';

    const verify = () => childProcess.spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; verify_build_output fixture "$2"',
        "verify-builtin-output",
        builderPath,
        buildDirectory,
      ],
      { encoding: "utf8" }
    );

    try {
      await fs.promises.mkdir(buildDirectory);
      await fs.promises.writeFile(indexPath, validIndex, "utf8");
      await fs.promises.writeFile(appPath, "window.fixture = true;\n", "utf8");
      assert.strictEqual(verify().status, 0);

      await fs.promises.writeFile(appPath, 'eval("webpack module");\n', "utf8");
      assert.match(verify().stderr, /eval-based Webpack wrapper/);

      await fs.promises.writeFile(appPath, "window.fixture = true;\n", "utf8");
      await fs.promises.writeFile(path.join(buildDirectory, "app.js.map"), "{}", "utf8");
      assert.match(verify().stderr, /production source map/);
      await fs.promises.rm(path.join(buildDirectory, "app.js.map"));

      await fs.promises.symlink(appPath, path.join(buildDirectory, "linked-app.js"));
      assert.match(verify().stderr, /symbolic link/);
      await fs.promises.rm(path.join(buildDirectory, "linked-app.js"));

      await fs.promises.writeFile(
        indexPath,
        validIndex.replace("script-src 'self';", "script-src 'self' 'unsafe-eval';"),
        "utf8"
      );
      assert.match(verify().stderr, /unsafe-eval/);
    } finally {
      await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects symlink artifacts and never follows an existing checksum symlink", async function () {
    const temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "verus-artifact-link-test-")
    );
    const artifactPath = path.join(temporaryDirectory, "Verus-Desktop.test");
    const artifactLink = path.join(temporaryDirectory, "artifact-link");
    const checksumPath = `${artifactPath}.sha256`;
    const unrelatedPath = path.join(temporaryDirectory, "unrelated.txt");

    try {
      await fs.promises.writeFile(artifactPath, "artifact", "utf8");
      await fs.promises.symlink(artifactPath, artifactLink);
      await assert.rejects(
        writeArtifactChecksum(artifactLink),
        /Release artifact must be a regular file/
      );

      await fs.promises.writeFile(unrelatedPath, "must remain unchanged", "utf8");
      await fs.promises.symlink(unrelatedPath, checksumPath);
      await writeArtifactChecksum(artifactPath);

      assert.strictEqual(
        await fs.promises.readFile(unrelatedPath, "utf8"),
        "must remain unchanged"
      );
      assert.strictEqual((await fs.promises.lstat(checksumPath)).isFile(), true);
      assert.strictEqual((await fs.promises.lstat(checksumPath)).isSymbolicLink(), false);
    } finally {
      await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("pins release inputs and freezes every dependency install in CI", async function () {
    const ci = await fs.promises.readFile(
      path.join(projectRoot, ".gitlab-ci.yml"),
      "utf8"
    );
    const builtinScript = await fs.promises.readFile(
      path.join(projectRoot, "scripts", "buildBuiltinPlugins.sh"),
      "utf8"
    );
    const packageJson = JSON.parse(
      await fs.promises.readFile(path.join(projectRoot, "package.json"), "utf8")
    );
    const guiPackageJson = JSON.parse(
      await fs.promises.readFile(
        path.join(projectRoot, "gui", "Verus-Desktop-GUI", "react", "package.json"),
        "utf8"
      )
    );

    assert.strictEqual(fs.existsSync(path.join(projectRoot, "yarn.lock")), true);
    assert.strictEqual(
      fs.existsSync(path.join(projectRoot, "gui", "Verus-Desktop-GUI", "react", "yarn.lock")),
      true
    );
    assert.match(
      guiPackageJson.scripts["test:security"],
      /--runner=jest-runner --env=node --watchman=false --runTestsByPath test\/securityHardening\.spec\.js/
    );

    assert.match(
      builtinScript,
      /readonly LOGIN_CONSENT_REPOSITORY="https:\/\/github\.com\/VerusCoin\/verus-login-consent-client\.git"/
    );
    assert.match(
      builtinScript,
      /readonly LOGIN_CONSENT_COMMIT="3ec11d7604245f622b9a4ad992db785e9389c3cc"/
    );
    assert.match(
      builtinScript,
      /readonly LOGIN_CONSENT_PATCH_SHA256="974c0a42acf04725206b8579fb503894349f13b3c551bf03838d8fea3f37b1c6"/
    );
    assert.match(
      builtinScript,
      /readonly PBAAS_VISUALIZER_REPOSITORY="https:\/\/github\.com\/VerusCoin\/verus-pbaas-visualizer\.git"/
    );
    assert.match(
      builtinScript,
      /readonly PBAAS_VISUALIZER_COMMIT="02a8b2914279e698370728cd1c6b64ec1360656e"/
    );
    assert.match(
      builtinScript,
      /readonly PBAAS_VISUALIZER_PATCH_SHA256="e588f1587aa9212e7d58b0813239763fe57f01f8dc32d749efc12d52549bf79a"/
    );
    assert.doesNotMatch(ci, /BUILTIN_(?:LOGIN_CONSENT|PBAAS_VISUALIZER)_/);

    const pinnedPatchDigests = new Map([
      [
        "verus-login-consent-client-csp.patch",
        "974c0a42acf04725206b8579fb503894349f13b3c551bf03838d8fea3f37b1c6",
      ],
      [
        "verus-pbaas-visualizer-csp.patch",
        "e588f1587aa9212e7d58b0813239763fe57f01f8dc32d749efc12d52549bf79a",
      ],
    ]);
    for (const [filename, expectedDigest] of pinnedPatchDigests) {
      const bytes = await fs.promises.readFile(
        path.join(projectRoot, "scripts", "patches", filename)
      );
      const patchText = bytes.toString("utf8");
      const addedLines = patchText
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
      assert.strictEqual(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        expectedDigest
      );
      assert.ok(
        addedLines.some((line) => line.includes('"sass": "1.77.8"')),
        `${filename} must replace native node-sass with exact Dart Sass`
      );
      assert.ok(
        !addedLines.some((line) => line.includes('"node-sass"')),
        `${filename} must not add node-sass`
      );
      assert.ok(
        addedLines.some((line) => line.includes("<% if (isProduction)")),
        `${filename} must leave development HMR outside the packaged CSP`
      );
    }

    const loginConsentPatch = await fs.promises.readFile(
      path.join(
        projectRoot,
        "scripts",
        "patches",
        "verus-login-consent-client-csp.patch"
      ),
      "utf8"
    );
    assert.match(loginConsentPatch, /submit_id_provisioning_request/);
    assert.match(loginConsentPatch, /get_id_provisioning_status/);
    assert.match(loginConsentPatch, /provisioning_capability/);
    assert.match(loginConsentPatch, /event\.source !== window/);
    assert.match(loginConsentPatch, /event\.origin === location\.origin/);
    assert.match(
      loginConsentPatch,
      /\/builtin\/verus-login-consent-client\/index\.html/
    );
    assert.doesNotMatch(
      loginConsentPatch,
      /^\+.*IPC_ORIGIN_PRODUCTION = ["']file:\/\//m
    );

    const visualizerPatch = await fs.promises.readFile(
      path.join(
        projectRoot,
        "scripts",
        "patches",
        "verus-pbaas-visualizer-csp.patch"
      ),
      "utf8"
    );
    assert.match(visualizerPatch, /event\.source !== window/);
    assert.match(visualizerPatch, /event\.origin === location\.origin/);
    assert.match(
      visualizerPatch,
      /\/builtin\/verus-pbaas-visualizer\/index\.html/
    );
    assert.doesNotMatch(
      visualizerPatch,
      /^\+.*IPC_ORIGIN_PRODUCTION = ["']file:\/\//m
    );

    const imageLines = ci
      .split("\n")
      .filter((line) => /^\s*image:\s*/.test(line));
    assert.ok(imageLines.length > 0, "expected at least one containerized build job");
    for (const line of imageLines) {
      assert.match(line, /@sha256:[0-9a-f]{64}\s*$/);
    }

    const installLines = [
      ...ci.split("\n"),
      ...builtinScript.split("\n"),
      ...Object.values(packageJson.scripts),
      ...Object.values(guiPackageJson.scripts),
    ].filter((line) => /\byarn install\b/.test(line));
    assert.ok(installLines.length > 0, "expected frozen Yarn installs");
    for (const line of installLines) {
      assert.match(line, /--frozen-lockfile/);
      assert.match(line, /--non-interactive/);
    }

    assert.match(builtinScript, /does not contain the required yarn\.lock/);
    assert.match(builtinScript, /Frozen dependency install changed \$\{name\}\/yarn\.lock/);
    assert.match(
      builtinScript,
      /NODE_OPTIONS="\$\{build_node_options\}" NODE_ENV=production yarn run build/
    );
    assert.match(builtinScript, /Security patch SHA-256 mismatch/);
    assert.match(builtinScript, /missing the required script-src 'self' meta CSP/);
    assert.match(builtinScript, /weakens CSP with unsafe-eval/);
    assert.match(builtinScript, /emitted a production source map/);
    assert.match(builtinScript, /emitted an eval-based Webpack wrapper/);
    assert.match(builtinScript, /still depends on native node-sass/);
    assert.match(builtinScript, /apply its file-renderer CSP only to production output/);
    assert.match(builtinScript, /hardened backend transport/);
    assert.match(builtinScript, /exact packaged loopback entry point/);
    assert.match(builtinScript, /git -C "\$\{checkout_dir\}" apply --check/);
    assert.doesNotMatch(ci, /git clone https:\/\/github\.com\/VerusCoin\/verus-/);
    assert.match(ci, /stages:\n\s+- security\n\s+- build/);
    assert.match(ci, /security:tests:[\s\S]*?stage: security/);
    assert.strictEqual(
      (ci.match(/yarn run test:security/g) || []).length,
      2
    );
    assert.strictEqual(
      (ci.match(/NODE_OPTIONS: --openssl-legacy-provider/g) || []).length,
      5
    );
    assert.match(
      ci,
      /build:mac:[\s\S]*?variables:\n\s+NODE_OPTIONS: --openssl-legacy-provider/
    );
    assert.strictEqual(
      (ci.match(/node scripts\/writeArtifactChecksums\.js/g) || []).length,
      4
    );
    assert.strictEqual(
      (ci.match(/\.sha256" "\$STAGING\/Verus-Desktop\//g) || []).length,
      4
    );
  });
});
