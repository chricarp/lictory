import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { after, before, test } from "node:test";
import { createElement } from "react";
import {
  createSender,
  MailConfigurationError,
  mailSettings,
  mailTransportSummary,
} from "@lictory/core/lib/mailer";

const production = {
  NODE_ENV: "production",
  PLATFORM_URL: "https://lictory.example.com",
};
const smtp = (settings: Record<string, string | undefined>) => {
  const result = mailSettings({
    ...production,
    SMTP_FROM: "a@b.c",
    ...settings,
  });
  assert.equal(result.transport, "smtp");
  return result;
};

void test("blank email settings fall back to the development defaults", () => {
  for (const value of [undefined, "", "   "])
    assert.deepEqual(
      mailSettings({
        RESEND_API_KEY: value,
        RESEND_FROM_EMAIL: value,
        SMTP_HOST: value,
        SMTP_PORT: value,
        SMTP_SECURE: value,
        SMTP_REQUIRE_TLS: value,
        SMTP_USER: value,
        SMTP_PASSWORD: value,
        SMTP_FROM: value,
      }),
      {
        transport: "smtp",
        host: "localhost",
        port: 1025,
        secure: false,
        requireTLS: false,
        auth: undefined,
        from: "Lictory <no-reply@lictory.local>",
        messageIdDomain: "localhost",
      },
    );
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

void test("port 465 uses implicit TLS, 587 and 25 upgrade with STARTTLS", () => {
  const host = "smtp.example.com";
  assert.equal(smtp({ SMTP_HOST: host, SMTP_PORT: "465" }).secure, true);
  assert.equal(smtp({ SMTP_HOST: host, SMTP_PORT: "587" }).secure, false);
  assert.equal(smtp({ SMTP_HOST: host, SMTP_PORT: "25" }).secure, false);
  // A configured production server defaults to the submission port.
  assert.equal(smtp({ SMTP_HOST: host }).port, 587);
  // Explicit settings win over the port's convention.
  const custom = smtp({
    SMTP_HOST: host,
    SMTP_PORT: "2465",
    SMTP_SECURE: "true",
    SMTP_REQUIRE_TLS: "false",
  });
  assert.equal(custom.secure, true);
  assert.equal(custom.requireTLS, false);
  const strict = smtp({ SMTP_HOST: host, SMTP_REQUIRE_TLS: "true" });
  assert.deepEqual([strict.secure, strict.requireTLS], [false, true]);
  assert.throws(
    () => smtp({ SMTP_HOST: host, SMTP_SECURE: "tls" }),
    /SMTP_SECURE/,
  );
});

void test("credentials, sender and Message-ID host come from the configuration", () => {
  const settings = smtp({
    SMTP_HOST: " smtp.example.com ",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: " secret with spaces ",
    SMTP_FROM: "Acme <no-reply@example.com>",
  });
  assert.deepEqual(settings.auth, {
    user: "mailer",
    pass: " secret with spaces ",
  });
  assert.equal(settings.host, "smtp.example.com");
  assert.equal(settings.from, "Acme <no-reply@example.com>");
  assert.equal(settings.messageIdDomain, "lictory.example.com");
  assert.deepEqual(
    mailTransportSummary({
      ...production,
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "a@b.c",
      SMTP_USER: "u",
      SMTP_PASSWORD: "p",
    }),
    {
      transport: "smtp",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: false,
      authenticated: true,
    },
  );
});

void test("production without a mail transport or sender refuses to start", () => {
  for (const source of [
    production,
    { ...production, RESEND_API_KEY: " ", SMTP_HOST: "" },
  ])
    assert.throws(
      () => mailTransportSummary(source),
      (error: unknown) =>
        error instanceof MailConfigurationError &&
        error.message.includes("SMTP_HOST") &&
        error.message.includes("RESEND_API_KEY"),
    );
  assert.throws(
    () => mailSettings({ ...production, SMTP_HOST: "smtp.example.com" }),
    /SMTP_FROM is required in production/,
  );
  assert.throws(
    () => mailSettings({ ...production, RESEND_API_KEY: "re_key" }),
    /RESEND_FROM_EMAIL is required in production/,
  );
  assert.equal(
    mailSettings({
      ...production,
      RESEND_API_KEY: "re_key",
      RESEND_FROM_EMAIL: "a@b.c",
    }).transport,
    "resend",
  );
});

// A plain SMTP server without STARTTLS, like an internal relay on port 25.
type Received = { commands: string[]; data: string[] };
const received: Received = { commands: [], data: [] };
const sockets = new Set<Socket>();
const server = createServer((socket: Socket) => {
  let buffer = "";
  let inData = false;
  let message = "";
  socket.write("220 test ESMTP\r\n");
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("data", (chunk) => {
    // A TLS ClientHello: a plain server cannot answer it.
    if (chunk[0] === 0x16) return void socket.destroy();
    buffer += chunk.toString("latin1");
    let index: number;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          received.data.push(message);
          message = "";
          socket.write("250 queued\r\n");
        } else message += `${line}\n`;
        continue;
      }
      received.commands.push(line);
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === "EHLO") socket.write("250-test\r\n250 8BITMIME\r\n");
      else if (verb === "DATA") {
        inData = true;
        socket.write("354 go ahead\r\n");
      } else if (verb === "QUIT") socket.end("221 bye\r\n");
      else socket.write("250 ok\r\n");
    }
  });
  socket.on("error", () => undefined);
});
let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  for (const socket of sockets) socket.destroy();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

const email = {
  to: "reviewer@example.com",
  subject: "Verify your email",
  text: "Verify",
  react: createElement("p", null, "Verify"),
  idempotencyKey: "verification-1",
};
const local = (settings: Record<string, string>) =>
  mailSettings({
    ...production,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(port),
    SMTP_FROM: "Acme <no-reply@example.com>",
    ...settings,
  });

void test("a plain relay receives the configured sender and Message-ID host", async () => {
  received.commands.length = received.data.length = 0;
  await createSender(local({}))(email);
  assert.ok(received.commands.includes("MAIL FROM:<no-reply@example.com>"));
  assert.equal(received.data.length, 1);
  assert.match(received.data[0]!, /^From: Acme <no-reply@example\.com>$/m);
  assert.match(
    received.data[0]!,
    /^Message-ID: <verification-1@lictory\.example\.com>$/m,
  );
});

void test("required STARTTLS and implicit TLS never fall back to plain text", async () => {
  for (const settings of [
    { SMTP_REQUIRE_TLS: "true" },
    { SMTP_SECURE: "true" },
  ]) {
    received.commands.length = received.data.length = 0;
    await assert.rejects(createSender(local(settings))(email), /TLS|SSL/);
    assert.ok(!received.commands.some((c) => c.startsWith("MAIL FROM")));
    assert.equal(received.data.length, 0);
  }
});
