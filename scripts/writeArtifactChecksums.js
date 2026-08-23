const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const input = fs.createReadStream(filePath);

  for await (const chunk of input) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function writeArtifactChecksum(filePath) {
  const absolutePath = path.resolve(filePath);
  const stat = await fs.promises.lstat(absolutePath);

  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Release artifact must be a regular file: ${filePath}`);
  }

  const digest = await sha256File(absolutePath);
  const checksumPath = `${absolutePath}.sha256`;
  const artifactName = path.basename(absolutePath);

  if (/[\r\n]/.test(artifactName)) {
    throw new Error(`Release artifact filename contains a line break: ${filePath}`);
  }

  const manifest = `${digest}  ${artifactName}\n`;
  const temporaryChecksumPath = path.join(
    path.dirname(checksumPath),
    `.${path.basename(checksumPath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
  );

  try {
    await fs.promises.writeFile(temporaryChecksumPath, manifest, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    await fs.promises.rename(temporaryChecksumPath, checksumPath);
  } finally {
    await fs.promises.rm(temporaryChecksumPath, { force: true });
  }

  return { artifactPath: absolutePath, checksumPath, digest, manifest };
}

async function main(args) {
  if (args.length === 0) {
    throw new Error("Usage: node scripts/writeArtifactChecksums.js <artifact> [artifact ...]");
  }

  const artifactPaths = [...args].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right))
  );

  for (const artifactPath of artifactPaths) {
    const result = await writeArtifactChecksum(artifactPath);
    process.stdout.write(
      `Recorded SHA-256 ${result.digest} for ${result.artifactPath}\n`
    );
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  sha256File,
  writeArtifactChecksum,
};
