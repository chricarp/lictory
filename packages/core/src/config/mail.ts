// The production mail-transport rule (lib/mailer.ts), reported with the other
// startup problems. Kept out of validate.ts so the migration runner's bundle
// does not include the mail libraries.
import type { ConfigurationRule } from "@lictory/core/config/validate";
import { MailConfigurationError, mailSettings } from "@lictory/core/lib/mailer";

export const mailTransportRule: ConfigurationRule = (source) => {
  try {
    mailSettings(source);
    return undefined;
  } catch (error) {
    // Other errors (an invalid SMTP_PORT, a missing PLATFORM_URL) are
    // reported by the declarations already.
    if (error instanceof MailConfigurationError) return error.message;
    return undefined;
  }
};
