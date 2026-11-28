// The shape of a Slack app's credentials, as its Basic Information page
// shows them. Pure, so the settings form marks the field at fault before
// saving and the server refuses the same values with the same words.

export type SlackAppCredentials = {
  appId: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
};
export type SlackCredentialField = keyof SlackAppCredentials;

const appIdPattern = /^A[A-Z0-9]{6,20}$/;
const clientIdPattern = /^\d{6,20}\.\d{6,20}$/;
const secretPattern = /^[a-f0-9]{16,64}$/i;

/** Each malformed field with what to do about it, in form order. */
export function slackCredentialProblems(
  input: SlackAppCredentials,
): { field: SlackCredentialField; message: string }[] {
  const problems: { field: SlackCredentialField; message: string }[] = [];
  if (!appIdPattern.test(input.appId.trim()))
    problems.push({
      field: "appId",
      message:
        "The App ID starts with A, as shown on the app's Basic Information page.",
    });
  if (!clientIdPattern.test(input.clientId.trim()))
    problems.push({
      field: "clientId",
      message:
        "The Client ID looks like 1234567890.1234567890 (Basic Information → App Credentials).",
    });
  if (!secretPattern.test(input.clientSecret.trim()))
    problems.push({
      field: "clientSecret",
      message:
        "The Client Secret is not in Slack's format. Copy it again from Basic Information → App Credentials (Show, then copy).",
    });
  if (!secretPattern.test(input.signingSecret.trim()))
    problems.push({
      field: "signingSecret",
      message:
        "The Signing Secret is not in Slack's format. Copy it again from Basic Information → App Credentials (Show, then copy).",
    });
  return problems;
}
