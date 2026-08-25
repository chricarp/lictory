import type {
  AttachEntityRequest,
  Attachment,
  CompleteUploadResponse,
  CreateAttachmentRequest,
  CreateNoteLinkRequest,
  CreateNoteRequest,
  CreateTriggerRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  DuplicateSuspicion,
  Entity,
  EntityInput,
  EntityType,
  GraphOverview,
  ListNotesQuery,
  ListNotesResponse,
  LocationEventRequest,
  MediaAsset,
  MomentRangeResponse,
  Note,
  NoteSummary,
  RegisterDeviceRequest,
  Trigger,
  UpdateEntityRequest,
  UpdateNoteEntityRequest,
  UpdateNoteRequest,
} from "@lictory/contracts";

type TokenProvider = () => Promise<string | null> | string | null;
type HeaderProvider = () =>
  | Promise<Record<string, string> | undefined>
  | Record<string, string>
  | undefined;

export type LictoryClientOptions = {
  baseUrl: string;
  getAccessToken?: TokenProvider;
  getAuthHeaders?: HeaderProvider;
  fetch?: typeof globalThis.fetch;
};

export class LictoryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "LictoryApiError";
  }
}

export type UploadProgress = {
  attachmentId: string;
  loaded: number;
  total: number;
};

function queryString(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function createLictoryClient(options: LictoryClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetch ?? globalThis.fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await options.getAccessToken?.();
    const authHeaders = await options.getAuthHeaders?.();
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      credentials: init.credentials ?? "include",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...authHeaders,
        ...init.headers,
      },
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new LictoryApiError(
        payload?.error?.message ?? `Request failed with ${response.status}`,
        response.status,
        payload?.error?.code ?? "request_failed",
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const client = {
    health: () => request<{ ok: true; service: string }>("/health"),

    /* ------------------------------- Notes ------------------------------- */

    listNotes: (query: Partial<ListNotesQuery> = {}) =>
      request<ListNotesResponse>(`/v1/notes${queryString(query)}`),

    getNote: (noteId: string) => request<{ note: Note }>(`/v1/notes/${noteId}`),

    createNote: (input: CreateNoteRequest = {}) =>
      request<{ note: Note }>("/v1/notes", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    updateNote: (noteId: string, input: UpdateNoteRequest) =>
      request<{ note: Note }>(`/v1/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    deleteNote: (noteId: string) =>
      request<void>(`/v1/notes/${noteId}`, { method: "DELETE" }),

    processNote: (noteId: string) =>
      request<{ note: Note }>(`/v1/notes/${noteId}/process`, {
        method: "POST",
      }),

    /* ---------------------------- Attachments ---------------------------- */

    createAttachment: (noteId: string, input: CreateAttachmentRequest) =>
      request<{
        attachment: Attachment;
        upload: {
          method: "PUT";
          url: string;
          headers: Record<string, string>;
          expiresAt: string;
        };
      }>(`/v1/notes/${noteId}/attachments`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    deleteAttachment: (noteId: string, attachmentId: string) =>
      request<void>(`/v1/notes/${noteId}/attachments/${attachmentId}`, {
        method: "DELETE",
      }),

    /**
     * Uploads straight to object storage using the presigned URL, then tells
     * the API the object has landed. `onProgress` is driven by XHR because
     * `fetch` cannot report upload progress in browsers.
     */
    async uploadAttachment(
      noteId: string,
      input: CreateAttachmentRequest & { body: Blob },
      onProgress?: (progress: UploadProgress) => void,
    ): Promise<Attachment> {
      const created = await client.createAttachment(noteId, {
        fileName: input.fileName,
        contentType: input.contentType,
        bytes: input.bytes,
        durationSeconds: input.durationSeconds,
      });

      await putBinary(
        created.upload.url,
        created.upload.headers,
        input.body,
        onProgress
          ? (loaded, total) =>
              onProgress({
                attachmentId: created.attachment.id,
                loaded,
                total,
              })
          : undefined,
        fetcher,
      );

      const completed = await request<CompleteUploadResponse>(
        `/v1/uploads/${created.attachment.id}/complete`,
        { method: "POST" },
      );
      return {
        ...created.attachment,
        status: completed.asset.status,
      };
    },

    /* ------------------------- Entities & graph -------------------------- */

    listEntities: (
      query: { type?: EntityType; types?: EntityType[]; q?: string } = {},
    ) =>
      request<{ entities: Entity[] }>(
        `/v1/entities${queryString({
          type: query.type,
          // The API takes a comma-separated list so one directory can render
          // more than one kind in a single request.
          types: query.types?.join(","),
          q: query.q,
        })}`,
      ),

    createEntity: (input: EntityInput) =>
      request<{ entity: Entity }>("/v1/entities", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    getEntity: (entityId: string) =>
      request<{
        entity: Entity;
        notes: NoteSummary[];
        related: Entity[];
        duplicates: DuplicateSuspicion[];
      }>(`/v1/entities/${entityId}`),

    updateEntity: (entityId: string, input: UpdateEntityRequest) =>
      request<{ entity: Entity }>(`/v1/entities/${entityId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    deleteEntity: (entityId: string) =>
      request<void>(`/v1/entities/${entityId}`, { method: "DELETE" }),

    mergeEntities: (targetId: string, sourceId: string) =>
      request<{ entity: Entity }>(`/v1/entities/${targetId}/merge`, {
        method: "POST",
        body: JSON.stringify({ sourceId }),
      }),

    /** Pairs the resolver could not separate confidently, awaiting a human. */
    listDuplicates: () =>
      request<{ duplicates: DuplicateSuspicion[] }>("/v1/entities/duplicates"),

    /** Sweeps the existing graph for pairs that look like the same thing. */
    scanDuplicates: () =>
      request<{ found: number }>("/v1/entities/duplicates/scan", {
        method: "POST",
      }),

    dismissDuplicate: (duplicateId: string) =>
      request<void>(`/v1/entities/duplicates/${duplicateId}/dismiss`, {
        method: "POST",
      }),

    graph: () => request<GraphOverview>("/v1/graph"),

    /**
     * Every moment occurring in a window, with repeats already expanded. The
     * calendar asks by range rather than paging the entity directory, because a
     * birthday recorded in 1990 is not near the top of any list sorted by
     * anything other than when it next happens.
     */
    listMoments: (range: { from: string; to: string }) =>
      request<MomentRangeResponse>(`/v1/moments${queryString(range)}`),

    search: (q: string) =>
      request<{ notes: NoteSummary[]; entities: Entity[] }>(
        `/v1/search${queryString({ q })}`,
      ),

    /* ----------------------- Note ↔ entity editing ----------------------- */

    attachEntity: (noteId: string, input: AttachEntityRequest) =>
      request<{ note: Note }>(`/v1/notes/${noteId}/entities`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    updateNoteEntity: (
      noteId: string,
      entityId: string,
      input: UpdateNoteEntityRequest,
    ) =>
      request<{ note: Note }>(`/v1/notes/${noteId}/entities/${entityId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    detachEntity: (noteId: string, entityId: string) =>
      request<void>(`/v1/notes/${noteId}/entities/${entityId}`, {
        method: "DELETE",
      }),

    /* ------------------------ Note ↔ note editing ------------------------ */

    linkNotes: (noteId: string, input: CreateNoteLinkRequest) =>
      request<{ note: Note }>(`/v1/notes/${noteId}/links`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    updateNoteLink: (
      noteId: string,
      linkId: string,
      status: "suggested" | "confirmed" | "rejected",
    ) =>
      request<{ note: Note }>(`/v1/notes/${noteId}/links/${linkId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),

    unlinkNotes: (noteId: string, linkId: string) =>
      request<void>(`/v1/notes/${noteId}/links/${linkId}`, {
        method: "DELETE",
      }),

    /* --------------------------- Legacy media ---------------------------- */

    listMedia: () => request<{ assets: MediaAsset[] }>("/v1/media"),

    createUpload: (input: CreateUploadRequest) =>
      request<CreateUploadResponse>("/v1/uploads", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    completeUpload: (assetId: string) =>
      request<CompleteUploadResponse>(`/v1/uploads/${assetId}/complete`, {
        method: "POST",
      }),

    async uploadBinary(
      input: CreateUploadRequest & { body: Blob | ArrayBuffer },
    ) {
      const created = await client.createUpload(input);
      const uploaded = await fetcher(created.upload.url, {
        method: created.upload.method,
        headers: created.upload.headers,
        body: input.body,
      });
      if (!uploaded.ok) {
        throw new LictoryApiError(
          `Object upload failed with ${uploaded.status}`,
          uploaded.status,
          "object_upload_failed",
        );
      }
      return client.completeUpload(created.asset.id);
    },

    /* ------------------------------ Triggers ----------------------------- */

    listTriggers: () => request<{ triggers: Trigger[] }>("/v1/triggers"),

    createTrigger: (
      input: CreateTriggerRequest & { noteId?: string; entityId?: string },
    ) =>
      request<{ trigger: Trigger }>("/v1/triggers", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    /**
     * Switches a reminder off, or back on. Works for reminders the
     * understanding pipeline armed on its own as well as hand-made ones.
     */
    setTriggerStatus: (triggerId: string, status: "active" | "cancelled") =>
      request<{ trigger: Trigger }>(`/v1/triggers/${triggerId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),

    registerDevice: (input: RegisterDeviceRequest) =>
      request<{ registered: true }>("/v1/devices", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    recordLocationEvent: (input: LocationEventRequest) =>
      request<{ matched: number }>("/v1/location-events", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };

  return client;
}

async function putBinary(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: ((loaded: number, total: number) => void) | undefined,
  fetcher: typeof globalThis.fetch,
): Promise<void> {
  if (!onProgress || typeof XMLHttpRequest === "undefined") {
    const response = await fetcher(url, { method: "PUT", headers, body });
    if (!response.ok) {
      throw new LictoryApiError(
        `Object upload failed with ${response.status}`,
        response.status,
        "object_upload_failed",
      );
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new LictoryApiError(
              `Object upload failed with ${xhr.status}`,
              xhr.status,
              "object_upload_failed",
            ),
          );
    xhr.onerror = () =>
      reject(new LictoryApiError("Network error", 0, "network_error"));
    xhr.send(body);
  });
}

export type LictoryClient = ReturnType<typeof createLictoryClient>;
