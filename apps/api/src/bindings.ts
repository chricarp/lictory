export type ProcessMediaParams = { assetId: string };
export type ProcessNoteParams = { noteId: string; userId: string };
export type FireTriggerParams = { triggerId: string; scheduledFor: string };

export type JobMessage =
  | { type: "process-media"; assetId: string }
  | { type: "process-note"; noteId: string; userId: string }
  | { type: "send-notification"; triggerId: string; userId: string };

/** Cloudflare bindings and secrets available to the Worker. */
export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  AI?: Ai;
  JOBS: Queue<JobMessage>;
  PROCESS_MEDIA: Workflow<ProcessMediaParams>;
  PROCESS_NOTE: Workflow<ProcessNoteParams>;
  FIRE_TRIGGER: Workflow<FireTriggerParams>;
  ENVIRONMENT: "development" | "preview" | "production";
  ALLOWED_ORIGINS: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  APPLE_APP_BUNDLE_IDENTIFIER?: string;
  PASSKEY_RP_ID: string;
  PASSKEY_ORIGINS?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  OPENAI_API_KEY?: string;
  /**
   * Optional forward-geocoding endpoint. Absent in local development, where
   * coordinates come from the model or are inherited from a broader place the
   * user already has. `{query}` is replaced with the URL-encoded address.
   */
  GEOCODER_URL?: string;
  GEOCODER_TOKEN?: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: {
    requestId: string;
    userId: string;
  };
};
