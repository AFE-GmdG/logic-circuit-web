import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  buildSidecarPackage,
  parseDockerfileCopySources,
  SIDECAR_MANIFEST_FILENAME,
  SIDECAR_ZIP_FILENAME,
} from "../../scripts/buildSidecarPackage.mjs";

import SidecarDownloadDialog from "../components/app/sidecarDownloadDialog";

type ExtractedZipEntry = {
  path: string;
  compressionMethod: number;
  crc32: number;
  externalAttributes: number;
  content: Buffer;
};

const REPO_ROOT = path.resolve(__dirname, "../..");

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

function computeCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZipArchive(zipBuffer: Buffer): ExtractedZipEntry[] {
  let eocdOffset = -1;
  for (let offset = zipBuffer.length - 22; offset >= 0; offset--) {
    if (zipBuffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("EOCD-Signatur nicht gefunden");
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries: ExtractedZipEntry[] = [];
  let cursor = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    expect(zipBuffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const compressionMethod = zipBuffer.readUInt16LE(cursor + 10);
    const crc32 = zipBuffer.readUInt32LE(cursor + 16);
    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const nameLen = zipBuffer.readUInt16LE(cursor + 28);
    const extraLen = zipBuffer.readUInt16LE(cursor + 30);
    const commentLen = zipBuffer.readUInt16LE(cursor + 32);
    const externalAttributes = zipBuffer.readUInt32LE(cursor + 38);
    const localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);
    const filePath = zipBuffer.toString("utf-8", cursor + 46, cursor + 46 + nameLen);

    expect(zipBuffer.readUInt32LE(localHeaderOffset)).toBe(0x04034b50);
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedPayload = zipBuffer.subarray(dataStart, dataStart + compressedSize);
    const content = compressionMethod === 8
      ? zlib.inflateRawSync(compressedPayload)
      : compressedPayload;

    expect(content.length).toBe(uncompressedSize);
    expect(computeCrc32(content)).toBe(crc32);

    entries.push({
      path: filePath,
      compressionMethod,
      crc32,
      externalAttributes,
      content,
    });

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

const noop = () => undefined;

describe("T-093: SidecarDownloadDialog & Sidecar-ZIP-Paket", () => {
  it("rendert SidecarDownloadDialog im geschlossenen Zustand nicht", () => {
    const html = renderToStaticMarkup(
      <SidecarDownloadDialog isOpen={false} onClose={noop} />,
    );
    expect(html).not.toContain("data-component=\"SidecarDownloadDialog\"");
    expect(html).not.toContain("role=\"dialog\"");
  });

  it("rendert SidecarDownloadDialog mit Version, ZIP-Link, Startbefehlen und Sicherheitshinweisen", () => {
    const expectedVersion = `v${process.env.VERSION}`;
    const html = renderToStaticMarkup(
      <SidecarDownloadDialog
        isOpen={true}
        onOpenByoSidecar={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain("data-component=\"SidecarDownloadDialog\"");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain(expectedVersion);
    expect(html).toContain(`href="./downloads/${SIDECAR_ZIP_FILENAME}"`);
    expect(html).toContain(`download="logic-circuit-sidecar-${expectedVersion}.zip"`);
    expect(html).toContain("node --experimental-strip-types server/standaloneServer.ts");
    expect(html).toContain("docker compose up -d");
    expect(html).toContain("MCP_ACCESS_KEY");
    expect(html).toContain("COLLAB_ACCESS_KEY");
    expect(html).toContain("MCP_ALLOWED_ORIGINS");
    expect(html).toContain("data-testid=\"sidecar-open-byo-btn\"");
  });

  it("erzeugt ein valides Sidecar-ZIP mit allen Dateien aus Dockerfile.mcp und Startskripten", () => {
    const dockerfileContent = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile.mcp"), "utf-8");
    const dockerfileSources = parseDockerfileCopySources(dockerfileContent);
    expect(dockerfileSources.length).toBeGreaterThan(5);
    expect(dockerfileSources).toContain("server/standaloneServer.ts");
    expect(dockerfileSources).toContain("server/mcpHttpHandler.ts");

    const pkg = buildSidecarPackage(REPO_ROOT);
    expect(pkg.zipBuffer.readUInt32LE(0)).toBe(0x04034b50);

    const extracted = readZipArchive(pkg.zipBuffer);
    const byPath = new Map(extracted.map((entry) => [entry.path, entry]));

    for (const sourcePath of dockerfileSources) {
      expect(byPath.has(sourcePath)).toBe(true);
    }

    const expectedGenerated = [
      "Dockerfile",
      "docker-compose.yml",
      ".env.example",
      "start.sh",
      "start.bat",
      "README.md",
      SIDECAR_MANIFEST_FILENAME,
    ];
    for (const fileName of expectedGenerated) {
      expect(byPath.has(fileName)).toBe(true);
    }

    const envExample = byPath.get(".env.example")!.content.toString("utf-8");
    expect(envExample).toContain("MCP_ACCESS_KEY=\n");
    expect(envExample).toContain("COLLAB_ACCESS_KEY=\n");
    expect(envExample).toContain("MCP_ALLOWED_ORIGINS=");
    expect(envExample).not.toContain("PRIVACY_RESPONSIBLE");

    const startShEntry = byPath.get("start.sh")!;
    const startSh = startShEntry.content.toString("utf-8");
    expect(startSh).not.toContain("\r\n");
    expect(startSh).toContain("node --experimental-strip-types server/standaloneServer.ts");
    expect((startShEntry.externalAttributes >>> 16) & 0o777).toBe(0o755);

    const startBat = byPath.get("start.bat")!.content.toString("utf-8");
    expect(startBat).toContain("node --experimental-strip-types server/standaloneServer.ts");

    const manifest = JSON.parse(
      byPath.get(SIDECAR_MANIFEST_FILENAME)!.content.toString("utf-8"),
    ) as typeof pkg.manifest;
    expect(manifest.version).toBe(process.env.VERSION);
    expect(manifest.nodeMinVersion).toBe("22");
    expect(manifest.defaultPort).toBe(3001);
    expect(manifest.downloadFileName).toBe(SIDECAR_ZIP_FILENAME);
    expect(manifest.files.length).toBe(extracted.length);
  });
});
