// The app host serves workspaces at the root: /{org}/..., with the account
// flows (sign-in, sign-up, welcome...) beside them.

// The app's entry page (lands in the first organization or onboarding).
export const appHome = /^https?:\/\/[^/]+\/(\?[^#]*)?$/;

// Any page of the signed-in app, as opposed to an account flow.
export const inApp =
  /^https?:\/\/[^/]+\/(?!(sign-in|sign-up|verify-email|welcome|forgot-password|reset-password|auth-error)(\/|\?|$))/;
