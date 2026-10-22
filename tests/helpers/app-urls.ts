// The app host serves workspaces at the root: /{org}/..., with the account
// flows (sign-in, sign-up, welcome...) beside them.

// The app's entry page (lands in the first organization or onboarding).
export const appHome = /^https?:\/\/[^/]+\/(\?[^#]*)?$/;

// Any page of the signed-in app, as opposed to an account flow.
export const inApp =
  /^https?:\/\/[^/]+\/(?!(sign-in|sign-up|verify-email|welcome|forgot-password|reset-password|auth-error)(\/|\?|$))/;

// Origins of the running stack (scripts/test-e2e.ts may offset the ports).
export const platformOrigin =
  process.env.E2E_PLATFORM_URL ?? "http://localhost:3001";
export const marketingOrigin =
  process.env.E2E_MARKETING_URL ?? "http://localhost:3101";

// Where signing in lands: the app or, before choosing a handle, the welcome page.
export const signedIn =
  /^https?:\/\/[^/]+\/(?!(sign-in|sign-up|verify-email|forgot-password|reset-password|auth-error)(\/|\?|$))/;
