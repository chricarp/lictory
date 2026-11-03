import assert from "node:assert/strict";
import { test } from "node:test";
import { aiModelId, DEFAULT_AI_MODEL } from "@lictory/core/ai/analyzer";
import { env, envInteger } from "@lictory/core/lib/env";
import { mailSettings } from "@lictory/core/lib/mailer";

// Compose forwards unset variables as empty strings (`${VAR:-}`).
const blanks = [{}, { VALUE: "" }, { VALUE: "   " }, { VALUE: "\n\t" }];

void test("empty, whitespace-only and unset variables are unset", () => {
  for (const source of blanks) {
    assert.equal(env("VALUE", source), undefined);
    assert.equal(envInteger("VALUE", source), undefined);
  }
  assert.equal(env("VALUE", { VALUE: "  set  " }), "set");
  assert.equal(envInteger("VALUE", { VALUE: " 587 " }), 587);
});

void test("a set value that is not a whole number is rejected", () => {
  for (const VALUE of ["abc", "25.5", "-1", "1e3"])
    assert.throws(() => envInteger("VALUE", { VALUE }), /VALUE/);
});

void test("the AI model falls back to the default when unset or blank", () => {
  for (const LICTORY_AI_MODEL of [undefined, "", "   "])
    assert.equal(aiModelId({ LICTORY_AI_MODEL }), DEFAULT_AI_MODEL);
  assert.equal(aiModelId({ LICTORY_AI_MODEL: " gpt-test " }), "gpt-test");
});

void test("blank email settings fall back to the SMTP defaults", () => {
  for (const value of [undefined, "", "   "]) {
    const settings = mailSettings({
      RESEND_API_KEY: value,
      RESEND_FROM_EMAIL: value,
      SMTP_HOST: value,
      SMTP_PORT: value,
      SMTP_USER: value,
      SMTP_PASSWORD: value,
      SMTP_FROM: value,
    });
    assert.deepEqual(settings, {
      transport: "smtp",
      host: "localhost",
      port: 1025,
      auth: undefined,
      from: "Lictory <no-reply@lictory.local>",
    });
  }
});

void test("blank Resend sender falls back to the default sender", () => {
  for (const RESEND_FROM_EMAIL of [undefined, "", "   "])
    assert.deepEqual(
      mailSettings({ RESEND_API_KEY: "re_key", RESEND_FROM_EMAIL }),
      {
        transport: "resend",
        apiKey: "re_key",
        from: "Lictory <no-reply@email.lictory.com>",
      },
    );
});

void test("configured email settings are used as given", () => {
  assert.deepEqual(
    mailSettings({
      SMTP_HOST: " smtp.example.com ",
      SMTP_PORT: "587",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: " secret with spaces ",
      SMTP_FROM: "Acme <no-reply@example.com>",
    }),
    {
      transport: "smtp",
      host: "smtp.example.com",
      port: 587,
      auth: { user: "mailer", pass: " secret with spaces " },
      from: "Acme <no-reply@example.com>",
    },
  );
  assert.equal(
    mailSettings({ RESEND_API_KEY: "re_key", RESEND_FROM_EMAIL: "a@b.c" }).from,
    "a@b.c",
  );
  assert.throws(() => mailSettings({ SMTP_PORT: "smtp" }), /SMTP_PORT/);
});
