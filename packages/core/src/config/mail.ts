// The production mail-transport rule (lib/mailer.ts), reported with the other
// startup problems: partial or invalid mail settings stop the service; no mail
// transport at all is a warning (an installation may rely on single sign-on). Kept out of validate.ts so the migration runner's bundle
// does not include the mail libraries.
import type { ConfigurationRule } from "@lictory/core/config/validate";
import { MailConfigurationError, mailSettings } from "@lictory/core/lib/mailer";

export const mailTransportRule: ConfigurationRule = (source) => {
  try {
    const settings = mailSettings(source);
    return settings.transport === "none"
      ? { warning: settings.reason }
      : undefined;
  } catch (error) {
    // Other errors (an invalid SMTP_PORT, a missing PLATFORM_URL) are
    // reported by the declarations already.
    if (error instanceof MailConfigurationError) return error.message;
    return undefined;
  }
};
