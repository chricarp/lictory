import { useEffect, useState } from "react";
import { safeCallbackPath } from "@lictory/core/lib/paths";
import { oauthErrorMessage } from "@lictory/core/lib/oauth-errors";
import { Button } from "@lictory/ui/button";
import { LoadingState } from "@lictory/ui/spinner";
import { StateIllustration } from "@lictory/ui/state-illustration";
import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "@lictory/platform/components/auth/auth-layout";
import { ForgotPasswordForm } from "@lictory/platform/components/auth/forgot-password-form";
import { HandleForm } from "@lictory/platform/components/auth/handle-form";
import { AccountLegalNotice } from "@lictory/platform/components/auth/legal-notice";
import { ResetPasswordForm } from "@lictory/platform/components/auth/reset-password-form";
import { SignInForm } from "@lictory/platform/components/auth/sign-in-form";
import { SignUpForm } from "@lictory/platform/components/auth/sign-up-form";
import { SocialButtons } from "@lictory/platform/components/auth/social-buttons";
import { VerificationStatus } from "@lictory/platform/components/auth/verification-status";
import { Link, useSearchParams } from "@lictory/platform/lib/navigation";
import {
  useAuthProviders,
  useSignInOptions,
} from "@lictory/platform/lib/session";
import { PageTitle } from "@lictory/platform/routes/title";

// Account flows: public pages inside the auth layout. Every destination after
// a step comes from `callbackUrl`/`next` and is limited to this app.

function useCallbackPath(name = "callbackUrl") {
  return safeCallbackPath(useSearchParams().get(name));
}

export function SignInPage() {
  const params = useSearchParams();
  const providers = useAuthProviders();
  const { password, ssoName } = useSignInOptions();
  const callbackURL = useCallbackPath();
  const here = `/sign-in?callbackUrl=${encodeURIComponent(callbackURL)}`;
  return (
    <>
      <PageTitle title="Sign in" />
      <AuthHeading title="Sign in to Lictory" />
      <AccountLegalNotice signIn />
      <SocialButtons
        providers={providers}
        ssoName={ssoName}
        passwordForm={password}
        callbackURL={callbackURL}
        errorCallbackURL={here}
        error={params.get("error") ?? undefined}
      />
      {/* SSO-only installations: the provider creates accounts as well. */}
      {password && (
        <>
          <SignInForm callbackURL={callbackURL} />
          <AuthFooter>
            New to Lictory?{" "}
            <AuthLink
              href={`/sign-up?callbackUrl=${encodeURIComponent(callbackURL)}`}
            >
              Create an account
            </AuthLink>
          </AuthFooter>
        </>
      )}
    </>
  );
}

export function SignUpPage() {
  const params = useSearchParams();
  const providers = useAuthProviders();
  const { password, ssoName } = useSignInOptions();
  const callbackURL = useCallbackPath();
  return (
    <>
      <PageTitle title="Create your account" />
      <AuthHeading title="Create your account" />
      <AccountLegalNotice />
      <SocialButtons
        providers={providers}
        ssoName={ssoName}
        passwordForm={password}
        callbackURL={callbackURL}
        errorCallbackURL={`/sign-up?callbackUrl=${encodeURIComponent(callbackURL)}`}
        error={params.get("error") ?? undefined}
      />
      {password && <SignUpForm callbackURL={callbackURL} />}
      <AuthFooter>
        Already have an account?{" "}
        <AuthLink
          href={`/sign-in?callbackUrl=${encodeURIComponent(callbackURL)}`}
        >
          Sign in
        </AuthLink>
      </AuthFooter>
    </>
  );
}

export function ForgotPasswordPage() {
  if (!useSignInOptions().password) return <PasswordLoginDisabled />;
  return (
    <>
      <PageTitle title="Reset your password" />
      <AuthHeading
        title="Reset your password"
        description="Enter your account email and we’ll send you a reset link."
      />
      <ForgotPasswordForm />
      <AuthFooter>
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </AuthFooter>
    </>
  );
}

export function ResetPasswordPage() {
  const token = useSearchParams().get("token") ?? undefined;
  if (!useSignInOptions().password) return <PasswordLoginDisabled />;
  return (
    <>
      <PageTitle title="Choose a new password" />
      <AuthHeading
        title="Choose a new password"
        description="Use at least 10 characters. A unique passphrase works best."
      />
      <ResetPasswordForm token={token} />
      <AuthFooter>
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </AuthFooter>
    </>
  );
}

function PasswordLoginDisabled() {
  return (
    <>
      <PageTitle title="Passwords are turned off" />
      <AuthHeading
        title="Passwords are turned off"
        description="This installation signs people in through your company account. There is no password to reset."
      />
      <AuthFooter>
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </AuthFooter>
    </>
  );
}

export function VerifyEmailPage() {
  const params = useSearchParams();
  const callbackURL = useCallbackPath();
  return (
    <>
      <PageTitle title="Verify your email" />
      <VerificationStatus
        callbackURL={callbackURL}
        email={params.get("email") ?? undefined}
        verified={params.get("verified") === "1"}
        errorCode={params.get("error") ?? undefined}
      />
    </>
  );
}

export function AuthErrorPage() {
  const message =
    oauthErrorMessage(useSearchParams().get("error"), "sign-in") ??
    "The authentication request could not be completed.";
  return (
    <>
      <PageTitle title="Sign-in interrupted" />
      <StateIllustration kind="recovery" />
      <AuthHeading title="Sign-in interrupted" description={message} />
      <Link href="/sign-in" className="contents">
        <Button size="lg" className="w-full">
          Try again
        </Button>
      </Link>
    </>
  );
}

type Suggestions = { current: string | null; suggestions: string[] };

// Required step for every new account (email or social) before the app. The
// route guarantees a signed-in session without a handle.
export function WelcomePage() {
  const destination = useCallbackPath("next");
  const [data, setData] = useState<Suggestions>();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/handle", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          (Suggestions & { error?: { message?: string } }) | null;
        if (!response.ok || !body)
          throw new Error(
            body?.error?.message ?? "Handle suggestions are unavailable.",
          );
        return body;
      })
      .then((body) => !cancelled && setData(body))
      .catch(() => {
        // Choosing a handle never depends on suggestions.
        if (!cancelled) setData({ current: null, suggestions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      <PageTitle title="Choose your handle" />
      <AuthHeading
        title="Choose your handle"
        description="How teammates @mention you. You can change it later."
      />
      {data ? (
        <HandleForm
          initial={data.suggestions[0] ?? ""}
          suggestions={data.suggestions}
          next={destination}
        />
      ) : (
        <LoadingState label="Preparing suggestions" />
      )}
    </>
  );
}
