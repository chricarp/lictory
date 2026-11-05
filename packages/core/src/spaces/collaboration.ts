// The Hocuspocus side of live drafts (spike): authentication, loading,
// persist-before-apply and revocation. See docs/internals/spaces.md.
//
// Hocuspocus processes one connection's messages in order and awaits
// `beforeHandleMessage` before it applies a message, broadcasts it to other
// editors and acknowledges it to the sender (SyncStatus). Storing document
// changes in that hook therefore makes "Saved" truthful and guarantees peers
// only ever see stored edits. Throwing closes the connection; the client keeps
// its unsaved changes and offers them again when it reconnects.
import type {
  Extension,
  Hocuspocus,
  beforeHandleMessagePayload,
  onAuthenticatePayload,
  onConfigurePayload,
  onLoadDocumentPayload,
} from "@hocuspocus/server";
import { Forbidden, MessageTooBig, ResetConnection } from "@hocuspocus/common";
import * as decoding from "lib0/decoding";
import * as Y from "yjs";
import { DomainError } from "@lictory/core/domain/errors";
import { authorize, type Database } from "@lictory/core/domain/service";
import {
  DraftWriter,
  hasSession,
  loadDraft,
  type DraftAccess,
  type DraftAuthor,
  type DraftRef,
} from "@lictory/core/spaces/drafts";

export type CollaborationContext = DraftAuthor & { ref: DraftRef };

type Options = {
  db: Database;
  // The authenticated person and session, from the request (the Better Auth
  // session cookie in production). Never from the document name or a
  // client-supplied id.
  authenticate: (request: onAuthenticatePayload) => Promise<DraftAuthor | null>;
  // Document names are opaque; the server decides which draft epoch one means.
  resolve: (documentName: string) => Promise<DraftRef | null>;
  canRead: DraftAccess;
  canEdit: DraftAccess;
  // How long a database failure is retried before the connection is reset.
  retryForMs?: number;
  // Every open connection is rechecked this often, bounding how long a missed
  // access-change signal can leave a revoked reader connected.
  revalidateEveryMs?: number;
};

// Yjs sync protocol, as framed by Hocuspocus: document name, message type,
// sync step. Only SyncStep2 and Update carry document changes.
const MESSAGE_SYNC = 0;
const MESSAGE_SYNC_REPLY = 4;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

export function documentChange(message: Uint8Array) {
  const decoder = decoding.createDecoder(message);
  decoding.readVarString(decoder);
  const type = decoding.readVarUint(decoder);
  if (type !== MESSAGE_SYNC && type !== MESSAGE_SYNC_REPLY) return null;
  const step = decoding.readVarUint(decoder);
  if (step !== SYNC_STEP_2 && step !== SYNC_UPDATE) return null;
  return {
    kind: step === SYNC_STEP_2 ? ("step2" as const) : ("update" as const),
    update: decoding.readVarUint8Array(decoder),
  };
}

// Hocuspocus closes the connection with the `code` and `reason` of what a hook
// throws.
class Refusal extends Error {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}
const forbidden = (reason: string) => new Refusal(Forbidden.code, reason);

// How a refused save closes the connection. Only domain messages (short, no
// content) reach the client and the log; anything else (a database failure)
// becomes a reset, after which the client reconnects and offers its unsaved
// changes again. Close reasons are limited to 123 bytes.
function refusal(error: unknown) {
  if (error instanceof DomainError && error.category === "validation")
    return new Refusal(MessageTooBig.code, error.message);
  if (
    error instanceof DomainError &&
    (error.category === "forbidden" || error.category === "not_found")
  )
    return forbidden(error.message);
  return new Refusal(
    ResetConnection.code,
    "Changes not saved yet; reconnecting.",
  );
}

export function draftCollaboration(options: Options) {
  const writers = new Map<string, DraftWriter>();

  let timer: ReturnType<typeof setInterval> | undefined;

  const access = async (author: DraftAuthor, ref: DraftRef) =>
    options.db.transaction(async (tx) => {
      if (!(await hasSession(tx, author))) return null;
      await authorize(tx, author.userId, ref.organizationId);
      if (!(await options.canRead(tx, author.userId, ref))) return null;
      return { edit: await options.canEdit(tx, author.userId, ref) };
    });

  const extension: Extension = {
    async onConfigure({ instance }: onConfigurePayload) {
      // Direct connections change the document without passing through
      // beforeHandleMessage, so they would bypass storage. Nothing in Lictory
      // needs them; refuse them outright.
      instance.openDirectConnection = () =>
        Promise.reject(
          new Error(
            "Direct connections bypass draft storage and are disabled.",
          ),
        );
      timer = setInterval(() => {
        void revalidate(instance);
      }, options.revalidateEveryMs ?? 30_000);
      timer.unref?.();
    },

    async onAuthenticate(payload: onAuthenticatePayload) {
      const author = await options.authenticate(payload);
      const ref = await options.resolve(payload.documentName);
      const allowed =
        author && ref ? await access(author, ref).catch(() => null) : null;
      if (!author || !ref || !allowed)
        throw forbidden("You do not have access to this page.");
      payload.connectionConfig.readOnly = !allowed.edit;
      return { ...author, ref } satisfies CollaborationContext;
    },

    async onLoadDocument({
      document,
      documentName,
      context,
    }: onLoadDocumentPayload) {
      const { ref } = context as CollaborationContext;
      const { state } = await loadDraft(options.db, ref);
      Y.applyUpdate(document, state);
      writers.set(
        documentName,
        new DraftWriter(options.db, ref, options.canEdit, options.retryForMs),
      );
      return document;
    },

    async beforeHandleMessage({
      connection,
      document,
      documentName,
      update: message,
    }: beforeHandleMessagePayload) {
      if (connection.readOnly) return;
      const change = documentChange(message);
      if (!change) return;
      // A reconnecting client's SyncStep2 usually repeats what is stored.
      if (
        change.kind === "step2" &&
        Y.snapshotContainsUpdate(Y.snapshot(document), change.update)
      )
        return;
      const writer = writers.get(documentName);
      if (!writer) throw forbidden("This draft is no longer available.");
      const { userId, sessionId } = connection.context as CollaborationContext;
      await writer
        .submit({ userId, sessionId }, change.update)
        .catch((error: unknown) => {
          const event = refusal(error);
          // Closing only this document would leave the client connected but
          // unsynced; resetting the socket makes it reconnect and resend.
          if (event.code === ResetConnection.code)
            connection.webSocket.close(event.code, event.reason);
          throw event;
        });
    },

    async afterUnloadDocument({ documentName }) {
      await writers.get(documentName)?.idle();
      writers.delete(documentName);
    },

    async onDestroy() {
      clearInterval(timer);
      await Promise.all([...writers.values()].map((w) => w.idle()));
    },
  };

  // Rechecks open connections (all, or one person's) against current access:
  // closes those that lost read access or whose session ended, and makes
  // read-only those that lost edit access. Runs after access changes
  // (signalled) and periodically.
  //
  // It never promotes a read-only connection: Hocuspocus re-reads `readOnly`
  // after beforeHandleMessage, so promoting mid-message could apply an update
  // the hook skipped as read-only. A person who gains edit access reconnects.
  async function revalidate(instance: Hocuspocus, userId?: string) {
    const checks = [...instance.documents.values()].flatMap((document) =>
      document
        .getConnections()
        .filter(
          (c) =>
            !userId || (c.context as CollaborationContext).userId === userId,
        )
        .map(async (connection) => {
          const context = connection.context as CollaborationContext;
          const allowed = await access(context, context.ref).catch(() => null);
          if (!allowed)
            connection.close(
              forbidden("You no longer have access to this page."),
            );
          else if (!allowed.edit) connection.readOnly = true;
        }),
    );
    await Promise.all(checks);
  }

  return { extension, revalidate };
}
