import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  buildCodexAuthorizeUrl,
  generateOauthState,
  generatePkce,
} from "../../src/infra/oauth";

describe("generatePkce", () => {
  test("produces an S256 challenge derived from the verifier", () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    const expected = createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
    // base64url → no padding or url-unsafe chars
    expect(codeChallenge).not.toContain("=");
    expect(codeChallenge).not.toContain("+");
    expect(codeChallenge).not.toContain("/");
  });

  test("is random across calls", () => {
    expect(generatePkce().codeVerifier).not.toBe(generatePkce().codeVerifier);
    expect(generateOauthState()).not.toBe(generateOauthState());
  });
});

describe("buildCodexAuthorizeUrl", () => {
  test("targets the OpenAI authorize endpoint with PKCE + Codex params", () => {
    const url = new URL(
      buildCodexAuthorizeUrl({
        redirectUri: "http://localhost:1455/auth/callback",
        pkce: { codeVerifier: "v", codeChallenge: "chal" },
        state: "st",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(p.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    expect(p.get("code_challenge")).toBe("chal");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toBe("st");
    expect(p.get("codex_cli_simplified_flow")).toBe("true");
  });
});
