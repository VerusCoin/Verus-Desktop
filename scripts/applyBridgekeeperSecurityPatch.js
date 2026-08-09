"use strict";

const fs = require("fs");
const path = require("path");

const bridgekeeperDirectory = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "verus_bridgekeeper"
);
const bridgekeeperEntry = path.join(bridgekeeperDirectory, "index.js");
const redundantCreateHashDirectory = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "bitgo-utxo-lib",
  "node_modules",
  "create-hash"
);
const bridgekeeperPackage = JSON.parse(
  fs.readFileSync(path.join(bridgekeeperDirectory, "package.json"), "utf8")
);

if (bridgekeeperPackage.version !== "1.0.6") {
  throw new Error(
    `Refusing to patch unsupported verus_bridgekeeper ${bridgekeeperPackage.version}`
  );
}

const replacements = [
  {
    description: "peer address validation",
    unsafe: "    var ip = request.headers['x-forwarded-for'] || request.connection.remoteAddress;",
    safeMarker: "    var ip = request.socket.remoteAddress;",
    safe: [
      "    // This server is a local daemon bridge, not a reverse-proxied service.",
      "    // Trust only the actual peer address: X-Forwarded-For is caller-controlled",
      "    // and would let a remote client spoof the configured RPC allowlist address.",
      "    var ip = request.socket.remoteAddress;",
    ].join("\n"),
  },
  {
    description: "loopback-only listener",
    unsafe: "        bridgeKeeperServer.listen(port);",
    safeMarker: "        bridgeKeeperServer.listen(port, '127.0.0.1');",
    safe: [
      "        // Never expose the daemon bridge to the LAN. The desktop API and the",
      "        // native daemon both communicate with it over the local machine.",
      "        bridgeKeeperServer.listen(port, '127.0.0.1');",
    ].join("\n"),
  },
];

let source = fs.readFileSync(bridgekeeperEntry, "utf8");
let changed = false;

for (const replacement of replacements) {
  const hasUnsafeCode = source.includes(replacement.unsafe);
  const hasSafeCode = source.includes(replacement.safeMarker);

  if (!hasUnsafeCode && hasSafeCode) continue;
  if (!hasUnsafeCode || hasSafeCode) {
    throw new Error(
      `Could not safely apply Bridgekeeper ${replacement.description} patch`
    );
  }

  source = source.replace(replacement.unsafe, replacement.safe);
  changed = true;
}

if (changed) {
  fs.writeFileSync(bridgekeeperEntry, source, "utf8");
  console.log("Applied verus_bridgekeeper loopback security patch");
} else {
  console.log("verus_bridgekeeper loopback security patch already applied");
}

// Preserve the project's existing deduplication step without relying on a
// Unix-only shell command in postinstall.
if (typeof fs.rmSync === "function") {
  fs.rmSync(redundantCreateHashDirectory, { force: true, recursive: true });
} else if (fs.existsSync(redundantCreateHashDirectory)) {
  // Node 13 satisfies this project's declared engine range but predates rmSync.
  fs.rmdirSync(redundantCreateHashDirectory, { recursive: true });
}
