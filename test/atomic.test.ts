import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { atomicWrite } from "../src/atomic.js";

describe("atomicWrite", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "betteremail-atomic-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a file with correct content", async () => {
    const filePath = path.join(tmpDir, "test.json");
    await atomicWrite(filePath, '{"hello":"world"}\n');
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe('{"hello":"world"}\n');
  });

  it("creates parent directories if they do not exist", async () => {
    const filePath = path.join(tmpDir, "nested", "deep", "test.json");
    await atomicWrite(filePath, "data\n");
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("data\n");
  });

  it("overwrites existing file atomically", async () => {
    const filePath = path.join(tmpDir, "test.json");
    await atomicWrite(filePath, "old content\n");
    await atomicWrite(filePath, "new content\n");
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("new content\n");
  });

  it("does not leave temp files on success", async () => {
    const filePath = path.join(tmpDir, "test.json");
    await atomicWrite(filePath, "content\n");
    const files = await fs.readdir(tmpDir);
    expect(files).toEqual(["test.json"]);
  });

  it("preserves original file if read during concurrent write", async () => {
    const filePath = path.join(tmpDir, "test.json");
    await atomicWrite(filePath, "original\n");

    // Start a write but read the file concurrently — original must be intact
    // until the rename completes (atomic guarantee)
    const writePromise = atomicWrite(filePath, "updated\n");
    const contentDuringWrite = await fs.readFile(filePath, "utf8");
    await writePromise;

    // Content during write should be either original or updated (never partial)
    expect(["original\n", "updated\n"]).toContain(contentDuringWrite);
  });
});
