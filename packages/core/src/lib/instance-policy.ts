// Instance policy: who may get an account on this installation and who may
// create organizations. Set by the operator through the environment and
// enforced by the server (Better Auth's user validation gate and the
// organization plugin), never by the browser alone. See
// docs/internals/instance-administration.md.
//
// Instance administrators are a separate concept from organization roles:
// they manage the installation (accounts, organizations, access policy) and
// gain no access to any organization's work by being administrators.

type Environment = Readonly<Record<string, string | undefined>>;

export const SIGN_UP_MODES = ["invite", "closed", "open"] as const;
// invite: a new account needs a pending organization invitation for its email.
// closed: only instance administrators create accounts.
// open:   anyone who can reach the installation may create one.
export type SignUpMode = (typeof SIGN_UP_MODES)[number];

export const ORGANIZATION_CREATION = ["administrators", "everyone"] as const;
export type OrganizationCreation = (typeof ORGANIZATION_CREATION)[number];

export type InstancePolicy = {
  signUpMode: SignUpMode;
  // Lowercase domains; empty means any domain.
  allowedEmailDomains: readonly string[];
  organizationCreation: OrganizationCreation;
  // Days between an owner scheduling an organization's deletion and the
  // deletion itself (docs/internals/organization-deletion.md).
  organizationDeletionGraceDays: number;
};

// How a new account would come to exist.
// - self-service: the person registers (email and password, Google, Microsoft)
// - identity-provider: the company OpenID Connect provider (just-in-time
//   provisioning, governed by OIDC_AUTO_CREATE_USERS: the provider is the
//   company directory, so it is not subject to the sign-up mode)
// - administrator: an instance administrator (admin console or server CLI)
export type AccountOrigin =
  "self-service" | "identity-provider" | "administrator";

export type AccountCreationProblem = { code: string; message: string };

const DOMAIN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function setting(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function oneOf<const T extends readonly string[]>(
  env: Environment,
  name: string,
  values: T,
  fallback: T[number],
): T[number] {
  const value = setting(env[name])?.toLowerCase();
  if (value === undefined) return fallback;
  if ((values as readonly string[]).includes(value)) return value;
  throw new Error(`${name} must be one of: ${values.join(", ")}.`);
}

export function parseEmailDomains(value: string | undefined) {
  const domains = new Set<string>();
  for (const raw of (setting(value) ?? "").split(/[\s,]+/)) {
    const domain = raw.trim().toLowerCase().replace(/^@/, "");
    if (!domain) continue;
    if (!DOMAIN.test(domain))
      throw new Error(
        `LICTORY_ALLOWED_EMAIL_DOMAINS: "${raw}" is not a domain such as example.com.`,
      );
    domains.add(domain);
  }
  return [...domains];
}

export const DEFAULT_ORGANIZATION_DELETION_GRACE_DAYS = 30;
const MAX_ORGANIZATION_DELETION_GRACE_DAYS = 365;

function graceDays(env: Environment) {
  const name = "LICTORY_ORGANIZATION_DELETION_GRACE_DAYS";
  const value = setting(env.LICTORY_ORGANIZATION_DELETION_GRACE_DAYS);
  if (value === undefined) return DEFAULT_ORGANIZATION_DELETION_GRACE_DAYS;
  const days = Number(value);
  if (
    !/^\d+$/.test(value) ||
    days < 1 ||
    days > MAX_ORGANIZATION_DELETION_GRACE_DAYS
  )
    throw new Error(
      `${name} must be a whole number of days from 1 to ${MAX_ORGANIZATION_DELETION_GRACE_DAYS}.`,
    );
  return days;
}

// Unset variables give the self-hosted defaults: invitations only, and only
// instance administrators create organizations. Invalid values stop the
// server at startup rather than silently opening the installation.
export function instancePolicy(env: Environment = process.env): InstancePolicy {
  return {
    signUpMode: oneOf(env, "LICTORY_SIGNUP_MODE", SIGN_UP_MODES, "invite"),
    allowedEmailDomains: parseEmailDomains(env.LICTORY_ALLOWED_EMAIL_DOMAINS),
    organizationCreation: oneOf(
      env,
      "LICTORY_ORGANIZATION_CREATION",
      ORGANIZATION_CREATION,
      "administrators",
    ),
    organizationDeletionGraceDays: graceDays(env),
  };
}

export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at < 0
    ? ""
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

export function emailDomainAllowed(policy: InstancePolicy, email: string) {
  return (
    policy.allowedEmailDomains.length === 0 ||
    policy.allowedEmailDomains.includes(emailDomain(email))
  );
}

// Why a new account may not be created, or null when it may. `invited` is
// whether a pending, unexpired invitation exists for the email.
export function accountCreationProblem(
  policy: InstancePolicy,
  request: { origin: AccountOrigin; email: string; invited: boolean },
): AccountCreationProblem | null {
  if (request.origin === "administrator") return null;
  if (!emailDomainAllowed(policy, request.email))
    return {
      code: "signup_domain_not_allowed",
      message:
        "Accounts on this installation are limited to your company's email domains. Use your work email, or ask your Lictory administrator for access.",
    };
  if (request.origin === "identity-provider") return null;
  if (policy.signUpMode === "open") return null;
  if (policy.signUpMode === "invite" && request.invited) return null;
  return policy.signUpMode === "invite"
    ? {
        code: "signup_invitation_required",
        message:
          "New accounts on this installation need an invitation. Ask an administrator of your organization to invite this email address, then use the link in the invitation.",
      }
    : {
        code: "signup_closed",
        message:
          "Accounts on this installation are created by its administrators. Ask your Lictory administrator for access.",
      };
}

export type InstanceRoleHolder = {
  instanceAdmin?: boolean | null;
  deactivatedAt?: Date | string | null;
};

export const isInstanceAdmin = (user: InstanceRoleHolder | null | undefined) =>
  user?.instanceAdmin === true && !user.deactivatedAt;

export function canCreateOrganization(
  policy: InstancePolicy,
  user: InstanceRoleHolder | null | undefined,
) {
  if (!user || user.deactivatedAt) return false;
  return policy.organizationCreation === "everyone" || isInstanceAdmin(user);
}

// Which origin a Better Auth provisioning source is.
export function accountOrigin(
  source: { method: string; oauth?: { providerId: string } | undefined },
  identityProviderId: string,
): AccountOrigin {
  if (source.method === "admin") return "administrator";
  if (
    source.method === "oauth" &&
    source.oauth?.providerId === identityProviderId
  )
    return "identity-provider";
  return "self-service";
}

export const ACCOUNT_DEACTIVATED = {
  code: "account_deactivated",
  message:
    "Your Lictory account has been deactivated. Ask your Lictory administrator if you need access again.",
} as const;
