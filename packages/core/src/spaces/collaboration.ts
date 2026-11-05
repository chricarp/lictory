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
  onLoadDocumentPayload,
} from "@hocuspocus/server";
import { Forbidden, MessageTooBig, ResetConnection } from "@hocuspocus/common";
import * as decoding from "lib0/decoding";
import * as Y from "yjs";
import { DomainError } from "@lictory/core/domain/errors";
import { authorize, type Database } from "@lictory/core/domain/service";
import {
  DraftWriter,
  loadDraft,
  type DraftAccess,
  type DraftRef,
} from "@lictory/core/spaces/drafts";

export type CollaborationContext = {
  userId: string;
  ref: DraftRef;
};

type Options = {
  db: Database;
  // The authenticated person, from the request (session cookie in
  // production). Never from the document name or a client-supplied id.
  authenticate: (request: onAuthenticatePayload) => Promise<string | null>;
  // Document names are opaque; the server decides which draft epoch one means.
  resolve: (documentName: string) => Promise<DraftRef | null>;
  canRead: DraftAccess;
  canEdit: DraftAccess;
  // How long a database failure is retried before the connection is reset.
  retryForMs?: number;
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

  const access = async (userId: string, ref: DraftRef) =>
    options.db.transaction(async (tx) => {
      await authorize(tx, userId, ref.organizationId);
      if (!(await options.canRead(tx, userId, ref))) return null;
      return { edit: await options.canEdit(tx, userId, ref) };
    });

  const extension: Extension = {
    async onAuthenticate(payload: onAuthenticatePayload) {
      const userId = await options.authenticate(payload);
      const ref = await options.resolve(payload.documentName);
      const allowed =
        userId && ref ? await access(userId, ref).catch(() => null) : null;
      if (!userId || !ref || !allowed)
        throw forbidden("You do not have access to this page.");
      payload.connectionConfig.readOnly = !allowed.edit;
      return { userId, ref } satisfies CollaborationContext;
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
      const { userId } = connection.context as CollaborationContext;
      await writer.submit(userId, change.update).catch((error: unknown) => {
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
      await Promise.all([...writers.values()].map((w) => w.idle()));
    },
  };

  // Rechecks every open connection against current access: closes those that
  // lost read access and makes read-only those that lost edit access. Runs
  // after access changes (signalled) and periodically, so a missed signal is
  // bounded by the period.
  async function revalidate(instance: Hocuspocus) {
    for (const document of instance.documents.values())
      for (const connection of document.getConnections()) {
        const { userId, ref } = connection.context as CollaborationContext;
        const allowed = await access(userId, ref).catch(() => null);
        if (!allowed)
          connection.close(
            forbidden("You no longer have access to this page."),
          );
        else connection.readOnly = !allowed.edit;
      }
  }

  return { extension, revalidate };
}
