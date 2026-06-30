import { describe, expect, test } from "bun:test";
import { blockedTarget } from "../../../src/domains/chat/web-tools";

describe("web_extract SSRF guard (blockedTarget)", () => {
  test("allows ordinary public http(s) URLs", () => {
    expect(blockedTarget("https://example.com/page")).toBeNull();
    expect(blockedTarget("http://news.ycombinator.com")).toBeNull();
  });

  test("blocks non-http(s) schemes", () => {
    expect(blockedTarget("file:///etc/passwd")).not.toBeNull();
    expect(blockedTarget("ftp://example.com")).not.toBeNull();
  });

  test("blocks loopback / private / link-local / metadata hosts", () => {
    for (const u of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/",
    ]) {
      expect(blockedTarget(u)).not.toBeNull();
    }
  });

  test("blocks decimal/hex IPv4 forms (URL normalises them to dotted-quad)", () => {
    expect(blockedTarget("http://2130706433/")).not.toBeNull(); // 127.0.0.1
    expect(blockedTarget("http://0x7f000001/")).not.toBeNull();
  });

  test("blocks IPv4-mapped IPv6 literals (the bypass)", () => {
    expect(blockedTarget("http://[::ffff:169.254.169.254]/")).not.toBeNull();
    expect(blockedTarget("http://[::ffff:127.0.0.1]/")).not.toBeNull();
    expect(blockedTarget("http://[::ffff:10.0.0.1]/")).not.toBeNull();
    expect(blockedTarget("http://[::1]/")).not.toBeNull();
  });
});
