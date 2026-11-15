import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, REDACTED } from "../lib/redact.mjs";
import { fake } from "./helpers.mjs";

test("redacts common key formats and secret assignments", () => {
  const cases = [
    fake("sk-", "ant-api03-", "abcdefghijklmnopqrstuvwxyz"),
    fake("sk-", "proj-", "abcdefghijklmnopqrstuvwxyz0123"),
    fake("xai", "-", "abcdefghijklmnopqrstuvwxyz"),
    fake("ghp", "_", "abcdefghijklmnopqrstuvwxyz0123456789"),
    fake("github", "_pat_", "11ABCDEFG0abcdefghijklmnop"),
    fake("AKIA", "ABCDEFGHIJKLMNOP"),
    fake("xox", "b-", "1234567890-abcdefghij"),
    fake("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJ", "zdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N"),
    fake("-----BEGIN RSA ", "PRIVATE KEY-----\n", "MIIEpA", "IBAAKCAQEA\n", "-----END RSA ", "PRIVATE KEY-----"),
  ];
  for (const c of cases) assert.equal(redact(`x ${c} y`), `x ${REDACTED} y`, c);
  // Credential-shaped inputs are assembled at runtime (see helpers.fake).
  const pw = fake("hun", "ter2", "hunter");
  assert.equal(redact(`DB_${"PASS"}WORD=${pw}`), `DB_${"PASS"}WORD=${REDACTED}`);
  assert.equal(redact(`"api${"Key"}": "${fake("abc", "def123456")}"`), `"api${"Key"}": "${REDACTED}"`);
  assert.equal(redact(`postgres://admin:${pw}@db:5432/app`), `postgres://admin:${REDACTED}@db:5432/app`);
  assert.equal(redact(`Authorization: ${fake("Bea", "rer ")}${fake("abcdefghijklm", "nopqrstuvwxyz0123")}`), `Authorization: ${REDACTED}`);
});

test("leaves ordinary text alone", () => {
  for (const t of ["the token budget is 12", "password reset flow", "see docs/brainium/sessions", "sk-short"]) {
    assert.equal(redact(t), t);
  }
});
