import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const SIDECAR_ZIP_FILENAME = "logic-circuit-sidecar.zip";
export const SIDECAR_MANIFEST_FILENAME = "sidecar-manifest.json";
export const SIDECAR_NODE_MIN_VERSION = "22";
export const SIDECAR_DEFAULT_PORT = 3001;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_DOS_TIME_FIXED = 0x0000;
const ZIP_DOS_DATE_FIXED = ((2026 - 1980) << 9) | (1 << 5) | 1;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Parst alle COPY-Quellpfade aus Dockerfile.mcp (Single Source of Truth)
export function parseDockerfileCopySources(dockerfileContent) {
  const rawLines = dockerfileContent.split(/\r?\n/);
  const logicalLines = [];
  let buffer = "";

  for (const line of rawLines) {
    const trimmedRight = line.trimEnd();
    if (buffer.length === 0 && /^\s*#/.test(trimmedRight)) {
      continue;
    }
    const hasContinuation = trimmedRight.endsWith("\\");
    const piece = hasContinuation ? trimmedRight.slice(0, -1).trim() : trimmedRight.trim();
    buffer = buffer.length > 0 ? `${buffer} ${piece}`.trim() : piece;
    if (!hasContinuation && buffer.length > 0) {
      logicalLines.push(buffer);
      buffer = "";
    }
  }
  if (buffer.length > 0) {
    logicalLines.push(buffer);
  }

  const sources = [];
  const seen = new Set();

  for (const line of logicalLines) {
    if (!/^COPY\s+/i.test(line)) {
      continue;
    }
    const rest = line.replace(/^COPY\s+/i, "").trim();
    const tokens = rest.split(/\s+/).filter((token) => !token.startsWith("--"));
    if (tokens.length < 2) {
      continue;
    }
    const sourceTokens = tokens.slice(0, -1);
    for (const token of sourceTokens) {
      const normalized = token.replace(/\\/g, "/").replace(/^\.\//, "");
      if (normalized.length > 0 && !seen.has(normalized)) {
        seen.add(normalized);
        sources.push(normalized);
      }
    }
  }

  return sources;
}

// Erstellt ein deterministisches ZIP-Archiv ausschließlich mit Node.js-Bordmitteln
export function createZipBuffer(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const normalizedPath = entry.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const nameBytes = Buffer.from(normalizedPath, "utf-8");
    const dataBuffer = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, "utf-8");
    const crc32 = computeCrc32(dataBuffer);
    const compressedCandidate = dataBuffer.length > 0 ? zlib.deflateRawSync(dataBuffer) : Buffer.alloc(0);
    const useDeflate = compressedCandidate.length > 0 && compressedCandidate.length < dataBuffer.length;
    const method = useDeflate ? ZIP_METHOD_DEFLATE : ZIP_METHOD_STORE;
    const payload = useDeflate ? compressedCandidate : dataBuffer;
    const unixMode = entry.mode ?? 0o100644;
    const externalAttributes = (unixMode << 16) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_FLAG_UTF8, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(ZIP_DOS_TIME_FIXED, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE_FIXED, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_FILE_SIGNATURE, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_FLAG_UTF8, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(ZIP_DOS_TIME_FIXED, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE_FIXED, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(externalAttributes, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localChunks.push(localHeader, nameBytes, payload);
    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

function buildEnvExampleContent() {
  return [
    "# Logic Circuit Web Sidecar Configuration (.env.example)",
    "# Copy to .env and adjust secrets / allowed origins before starting.",
    "",
    "PORT=3001",
    "HOST=0.0.0.0",
    "",
    "# Optional shared keys (leave empty for open local access on localhost)",
    "MCP_ACCESS_KEY=",
    "COLLAB_ACCESS_KEY=",
    "",
    "# Comma-separated browser origins allowed via CORS / WebSocket",
    "# Example for GitHub Pages + custom web origin:",
    "MCP_ALLOWED_ORIGINS=https://afe-gmdg.github.io",
    "COLLAB_ALLOWED_ORIGINS=https://afe-gmdg.github.io",
    "",
    "# Session & timeout tuning (ms)",
    "MCP_REQUEST_TIMEOUT_MS=600000",
    "MCP_SESSION_GRACE_MS=120000",
    "MCP_HEARTBEAT_INTERVAL_MS=25000",
    "MCP_MAX_SESSIONS=20",
    "MCP_MAX_HTTP_SESSIONS=50",
    "MCP_HTTP_SESSION_TTL_MS=1800000",
    "MCP_MAX_CONCURRENT_CALLS_PER_SESSION=4",
    "MCP_TRUST_PROXY=true",
    "",
    "# Sliding-window rate limits per minute (0 disables a limit)",
    "RATE_LIMIT_HTTP_PER_MIN=60",
    "RATE_LIMIT_STATUS_PER_MIN=30",
    "RATE_LIMIT_AUTH_FAIL_PER_MIN=5",
    "RATE_LIMIT_WS_PER_MIN=10",
    "",
    "# WebRTC collaboration defaults (STUN only, no TURN in v1)",
    "COLLAB_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302",
    "COLLAB_INVITE_TTL_MS=300000",
    "COLLAB_GRACE_PERIOD_MS=30000",
    "COLLAB_MAX_SESSIONS=50",
    "COLLAB_MAX_PEERS_PER_SESSION=16",
    "COLLAB_MAX_MESSAGE_BYTES=65536",
    "",
  ].join("\n");
}

function buildDockerComposeContent() {
  return [
    "services:",
    "  logiccircuit-sidecar:",
    "    build:",
    "      context: .",
    "      dockerfile: Dockerfile",
    "    container_name: logiccircuit-sidecar",
    "    restart: unless-stopped",
    "    read_only: true",
    "    cap_drop:",
    "      - ALL",
    "    security_opt:",
    "      - no-new-privileges:true",
    "    ports:",
    "      - \"${PORT:-3001}:3001\"",
    "    environment:",
    "      PORT: \"3001\"",
    "      HOST: \"0.0.0.0\"",
    "      MCP_ACCESS_KEY: ${MCP_ACCESS_KEY:-}",
    "      MCP_ALLOWED_ORIGINS: ${MCP_ALLOWED_ORIGINS:-https://afe-gmdg.github.io}",
    "      MCP_TRUST_PROXY: ${MCP_TRUST_PROXY:-true}",
    "      MCP_MAX_SESSIONS: ${MCP_MAX_SESSIONS:-20}",
    "      MCP_MAX_HTTP_SESSIONS: ${MCP_MAX_HTTP_SESSIONS:-50}",
    "      MCP_HTTP_SESSION_TTL_MS: ${MCP_HTTP_SESSION_TTL_MS:-1800000}",
    "      MCP_MAX_CONCURRENT_CALLS_PER_SESSION: ${MCP_MAX_CONCURRENT_CALLS_PER_SESSION:-4}",
    "      RATE_LIMIT_HTTP_PER_MIN: ${RATE_LIMIT_HTTP_PER_MIN:-60}",
    "      RATE_LIMIT_STATUS_PER_MIN: ${RATE_LIMIT_STATUS_PER_MIN:-30}",
    "      RATE_LIMIT_AUTH_FAIL_PER_MIN: ${RATE_LIMIT_AUTH_FAIL_PER_MIN:-5}",
    "      RATE_LIMIT_WS_PER_MIN: ${RATE_LIMIT_WS_PER_MIN:-10}",
    "      COLLAB_ACCESS_KEY: ${COLLAB_ACCESS_KEY:-}",
    "      COLLAB_ALLOWED_ORIGINS: ${COLLAB_ALLOWED_ORIGINS:-https://afe-gmdg.github.io}",
    "      COLLAB_STUN_URLS: ${COLLAB_STUN_URLS:-stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302}",
    "",
  ].join("\n");
}

function buildStartShContent() {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "",
    "SCRIPT_DIR=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\"",
    "cd \"$SCRIPT_DIR\"",
    "",
    "if [ -f .env ]; then",
    "  set -a",
    "  # shellcheck disable=SC1091",
    "  . ./.env",
    "  set +a",
    "fi",
    "",
    "if ! command -v node >/dev/null 2>&1; then",
    "  echo \"Error: Node.js 22+ is required.\" >&2",
    "  exit 1",
    "fi",
    "",
    "NODE_MAJOR=\"$(node -p \"process.versions.node.split('.')[0]\")\"",
    "if [ \"$NODE_MAJOR\" -lt 22 ]; then",
    "  echo \"Error: Node.js 22 or newer is required (found v$(node -v)).\" >&2",
    "  exit 1",
    "fi",
    "",
    "exec node --experimental-strip-types server/standaloneServer.ts",
    "",
  ].join("\n");
}

function buildStartBatContent() {
  return [
    "@echo off",
    "setlocal EnableDelayedExpansion",
    "cd /d \"%~dp0\"",
    "",
    "if exist .env (",
    "  for /f \"usebackq eol=# tokens=1,* delims==\" %%A in (\".env\") do (",
    "    if not \"%%~A\"==\"\" set \"%%~A=%%~B\"",
    "  )",
    ")",
    "",
    "where node >nul 2>nul",
    "if errorlevel 1 (",
    "  echo Error: Node.js 22+ is required.",
    "  exit /b 1",
    ")",
    "",
    "node --experimental-strip-types server/standaloneServer.ts",
    "",
  ].join("\r\n");
}

function buildReadmeContent(version) {
  return [
    `# Logic Circuit Web Sidecar (v${version})`,
    "",
    "Zero-dependency Streamable-HTTP MCP relay & WebRTC collaboration signaling server.",
    "",
    "## Requirements",
    "- **Node.js 22+** (runs TypeScript natively via `--experimental-strip-types`) OR **Docker / Docker Compose**.",
    "",
    "## Quick Start (Node.js 22+)",
    "- Optional: Copy `.env.example` to `.env` and set `MCP_ACCESS_KEY`, `COLLAB_ACCESS_KEY`, and `MCP_ALLOWED_ORIGINS`.",
    "- Run `./start.sh` (Linux / macOS) or `start.bat` (Windows), or directly:",
    "```bash",
    "node --experimental-strip-types server/standaloneServer.ts",
    "```",
    "- Default address: `http://localhost:3001` (`/mcp`, `/ws-mcp`, `/__mcp/status`, `/ws-collab`, `/__collab/config`, `/healthz`).",
    "",
    "## Quick Start (Docker Compose)",
    "```bash",
    "cp .env.example .env",
    "docker compose up -d",
    "```",
    "",
    "## Connect from Logic Circuit Web",
    "- Open **Help -> BYO SideCar** (or click the **MCP** indicator in the status bar).",
    "- Enter your Sidecar URL (for local runs: `http://localhost:3001`) and optional access keys.",
    "- Configure your AI MCP client to use Streamable HTTP: `http://localhost:3001/mcp`.",
    "",
  ].join("\n");
}

// Sammelt alle Dateien für das Sidecar-ZIP anhand von Dockerfile.mcp und Zusatzdateien
export function collectSidecarPackageEntries(repoRoot = DEFAULT_REPO_ROOT) {
  const pkgPath = path.join(repoRoot, "package.json");
  const dockerfilePath = path.join(repoRoot, "Dockerfile.mcp");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const dockerfileContent = fs.readFileSync(dockerfilePath, "utf-8");
  const copySources = parseDockerfileCopySources(dockerfileContent);

  const entries = [];
  const includedPaths = new Set();

  for (const relPath of copySources) {
    const absPath = path.resolve(repoRoot, relPath);
    if (!absPath.startsWith(repoRoot + path.sep) && absPath !== repoRoot) {
      throw new Error(`Ungültiger COPY-Pfad außerhalb des Repositories: ${relPath}`);
    }
    if (!fs.existsSync(absPath)) {
      throw new Error(`In Dockerfile.mcp referenzierte Datei fehlt: ${relPath}`);
    }
    entries.push({
      path: relPath,
      data: fs.readFileSync(absPath),
      mode: 0o100644,
    });
    includedPaths.add(relPath);
  }

  const extraFiles = [
    { path: "Dockerfile", data: Buffer.from(dockerfileContent, "utf-8"), mode: 0o100644 },
    { path: "docker-compose.yml", data: Buffer.from(buildDockerComposeContent(), "utf-8"), mode: 0o100644 },
    { path: ".env.example", data: Buffer.from(buildEnvExampleContent(), "utf-8"), mode: 0o100644 },
    { path: "start.sh", data: Buffer.from(buildStartShContent(), "utf-8"), mode: 0o100755 },
    { path: "start.bat", data: Buffer.from(buildStartBatContent(), "utf-8"), mode: 0o100644 },
    { path: "README.md", data: Buffer.from(buildReadmeContent(pkg.version), "utf-8"), mode: 0o100644 },
  ];

  for (const extra of extraFiles) {
    if (!includedPaths.has(extra.path)) {
      entries.push(extra);
      includedPaths.add(extra.path);
    }
  }

  const manifest = {
    version: pkg.version,
    nodeMinVersion: SIDECAR_NODE_MIN_VERSION,
    defaultPort: SIDECAR_DEFAULT_PORT,
    downloadFileName: SIDECAR_ZIP_FILENAME,
    endpoints: {
      mcpHttp: "/mcp",
      mcpWs: "/ws-mcp",
      mcpStatus: "/__mcp/status",
      collabWs: "/ws-collab",
      collabConfig: "/__collab/config",
      healthz: "/healthz",
    },
    files: [...entries.map((entry) => entry.path), SIDECAR_MANIFEST_FILENAME],
  };

  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  entries.push({
    path: SIDECAR_MANIFEST_FILENAME,
    data: Buffer.from(manifestJson, "utf-8"),
    mode: 0o100644,
  });

  return {
    version: pkg.version,
    manifest,
    manifestJson,
    entries,
  };
}

// Erzeugt Manifest und ZIP-Buffer vollständig im Speicher
export function buildSidecarPackage(repoRoot = DEFAULT_REPO_ROOT) {
  const { version, manifest, manifestJson, entries } = collectSidecarPackageEntries(repoRoot);
  const zipBuffer = createZipBuffer(entries);
  return {
    version,
    manifest,
    manifestJson,
    zipBuffer,
  };
}

// Schreibt das erzeugte Sidecar-ZIP und das Manifest in ein Zielverzeichnis
export function writeSidecarPackage(outputDir, repoRoot = DEFAULT_REPO_ROOT) {
  const { version, manifest, manifestJson, zipBuffer } = buildSidecarPackage(repoRoot);
  fs.mkdirSync(outputDir, { recursive: true });
  const zipPath = path.join(outputDir, SIDECAR_ZIP_FILENAME);
  const manifestPath = path.join(outputDir, SIDECAR_MANIFEST_FILENAME);
  fs.writeFileSync(zipPath, zipBuffer);
  fs.writeFileSync(manifestPath, manifestJson, "utf-8");

  return {
    version,
    manifest,
    zipPath,
    manifestPath,
    byteLength: zipBuffer.length,
  };
}

const isDirectEntry =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectEntry) {
  const outFlagIndex = process.argv.indexOf("--out");
  const customOutDir = outFlagIndex >= 0 && process.argv[outFlagIndex + 1]
    ? process.argv[outFlagIndex + 1]
    : path.join(DEFAULT_REPO_ROOT, "dist", "downloads");
  const result = writeSidecarPackage(path.resolve(customOutDir), DEFAULT_REPO_ROOT);
  console.log(
    `[sidecar-package] Erzeugt: ${result.zipPath} (v${result.version}, ${result.byteLength} Bytes, ${result.manifest.files.length} Dateien)`,
  );
}
