"use strict";

// Opt-in network regression check; never loads the wallet application.
// Run: ./node_modules/.bin/electron scripts/verifyElectronTls.js
// Node-only: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/verifyElectronTls.js
// The main-process run also checks Chromium and uses a disposable profile.
// Targets: https://emudhra.we-have-a-problem.com/ (October 2026 incident).
// All twelve TLS chains are listed in the site's index.html HOSTS array.
// This checks TLS trust only, not OS code-signing trust or wallet behavior.

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const tls = require("tls");

const TIMEOUT_MS = 15000;
const TARGETS = [
  { url: "https://example.com/", expect: "accepted" },
  ...["dv-g3b", "dv-g3c", "ov-g3b", "ov-g3c", "ev-g3b", "ev-g3c"]
    .flatMap((intermediate) => ["", "-aaa"].map((crossSign) => ({
      url: `https://${intermediate}${crossSign}-emudhra.we-have-a-problem.com/`,
      expect: "rejected",
    }))),
];

// Expiry, hostname mismatches, DNS failures and timeouts do not demonstrate
// distrust of the compromised CA keys, so they deliberately do not pass.
const TRUST_ERRORS = new Set([
  "CERT_REJECTED",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_CERT_AUTHORITY_INVALID",
  "ERR_CERT_REVOKED",
]);

function errorDetails(error) {
  const details = [];
  for (let current = error; current && details.length < 5; current = current.cause) {
    const message = String(current.message || current);
    const chromiumCode = message.match(/\bnet::(ERR_[A-Z_]+)\b/);
    details.push({
      code: current.code || (chromiumCode && chromiumCode[1]) || "UNKNOWN",
      message,
    });
  }
  return details;
}

function rejected(error) {
  const errors = errorDetails(error);
  return {
    outcome: errors.some(({ code }) => TRUST_ERRORS.has(code))
      ? "rejected"
      : "inconclusive",
    errors,
  };
}

function peerChain(socket) {
  const chain = [];
  const seen = new Set();
  let certificate = socket.getPeerCertificate(true);
  while (certificate && certificate.fingerprint256 && !seen.has(certificate.fingerprint256)) {
    seen.add(certificate.fingerprint256);
    chain.push({
      subject: certificate.subject && certificate.subject.CN,
      issuer: certificate.issuer && certificate.issuer.CN,
      sha256: certificate.fingerprint256.replace(/:/g, ""),
    });
    certificate = certificate.issuerCertificate;
  }
  return chain;
}

function probeConnection(url, transport, electron) {
  return new Promise((resolve) => {
    let connection;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
      if (connection) {
        if (transport === "chromium:net") connection.abort();
        else connection.destroy();
      }
    };
    // Wall-clock deadline includes DNS lookup and connection establishment.
    const timer = setTimeout(() => finish(rejected({
      code: "TEST_TIMEOUT",
      message: `No TLS verdict within ${TIMEOUT_MS} ms`,
    })), TIMEOUT_MS);

    try {
      if (transport === "node:tls") {
        const target = new URL(url);
        connection = tls.connect({
          host: target.hostname,
          port: 443,
          servername: target.hostname,
          rejectUnauthorized: true,
        });
        connection.once("secureConnect", () => finish({
          outcome: connection.authorized ? "accepted" : "inconclusive",
          authorized: connection.authorized,
          chain: peerChain(connection),
        }));
      } else if (transport === "node:https") {
        connection = https.get(url, { agent: false }, (response) => {
          response.on("error", (error) => finish(rejected(error)));
          // Any HTTP response proves TLS was accepted; do not follow redirects.
          finish({
            outcome: "accepted",
            status: response.statusCode,
            chain: peerChain(response.socket),
          });
        });
      } else {
        connection = electron.net.request({ url, redirect: "manual" });
        connection.once("response", (response) => {
          response.on("error", (error) => finish(rejected(error)));
          finish({ outcome: "accepted", status: response.statusCode });
        });
        connection.once("redirect", (status) => finish({
          outcome: "accepted",
          status,
        }));
      }
      connection.once("error", (error) => finish(rejected(error)));
      if (transport === "chromium:net") connection.end();
    } catch (error) {
      finish(rejected(error));
    }
  });
}

async function probeFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
    });
    if (response.body) await response.body.cancel();
    return { outcome: "accepted", status: response.status };
  } catch (error) {
    return rejected(error);
  } finally {
    clearTimeout(timer);
  }
}

let electron;
let temporaryProfile;

async function run() {
  if (!process.versions.electron) {
    throw new Error("Run this script with the Electron executable, not the system Node.js.");
  }
  const mainProcess = process.type === "browser";
  if (mainProcess) {
    electron = require("electron");
    temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), "verus-electron-tls-"));
    electron.app.setPath("userData", temporaryProfile);
    electron.app.setPath("sessionData", temporaryProfile);
    electron.app.setPath("crashDumps", path.join(temporaryProfile, "crashes"));
    electron.app.setAppLogsPath(path.join(temporaryProfile, "logs"));
    await electron.app.whenReady();
  }

  const transports = ["node:tls", "node:https"];
  const unavailable = [];
  if (typeof fetch === "function") transports.push("node:fetch");
  else unavailable.push("node:fetch");
  if (mainProcess) transports.push("chromium:net");
  else unavailable.push("chromium:net (requires an Electron main-process run)");

  const results = [];
  for (const transport of transports) {
    results.push(...await Promise.all(TARGETS.map(async (target) => {
      const result = transport === "node:fetch"
        ? await probeFetch(target.url)
        : await probeConnection(target.url, transport, electron);
      return { transport, ...target, ...result, passed: result.outcome === target.expect };
    })));
  }

  return {
    passed: results.every(({ passed }) => passed),
    mode: mainProcess ? "electron-main" : "electron-node",
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    source: "https://emudhra.we-have-a-problem.com/",
    checkedAt: new Date().toISOString(),
    unavailable,
    results,
  };
}

function output(report) {
  const exitCode = report.passed ? 0 : 1;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () => {
    if (electron) electron.app.exit(exitCode);
    else process.exit(exitCode);
  });
}

process.on("exit", () => {
  if (temporaryProfile) {
    try {
      fs.rmSync(temporaryProfile, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(`Could not remove temporary TLS test profile: ${error.message}\n`);
    }
  }
});

run().then(output, (error) => output({ passed: false, errors: errorDetails(error) }));
