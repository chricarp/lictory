import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

import type { Extraction } from "@lictory/contracts";

import type {
  Env,
  FireTriggerParams,
  ProcessMediaParams,
  ProcessNoteParams,
} from "../../bindings";
import type { MediaRow, NoteRow } from "../../infrastructure/database/rows";
import {
  describeImage,
  documentToText,
  extractStructure,
  hasOpenAiGateway,
  transcribeAudio,
} from "./extraction";
import { heuristicExtraction } from "./heuristics";
import { attachEntityToNote, markStep, resolveEntity } from "../notes/service";

/* -------------------------------------------------------------------------- */
/*                        Legacy single-asset processing                      */
/* -------------------------------------------------------------------------- */

export class ProcessMediaWorkflow extends WorkflowEntrypoint<
  Env,
  ProcessMediaParams
> {
  async run(event: WorkflowEvent<ProcessMediaParams>, step: WorkflowStep) {
    const { assetId } = event.payload;
    try {
      const asset = await step.do("load asset", async () => {
        const row = await this.env.DB.prepare(
          "SELECT * FROM media_assets WHERE id = ?",
        )
          .bind(assetId)
          .first<MediaRow>();
        if (!row) throw new Error(`Unknown media asset ${assetId}`);
        await this.env.DB.prepare(
          "UPDATE media_assets SET status = 'processing', updated_at = ? WHERE id = ?",
        )
          .bind(new Date().toISOString(), assetId)
          .run();
        return row;
      });

      const aiResult = await step.do(
        "run AI model",
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
        () => describeAsset(this.env, asset),
      );

      await step.do("persist result", async () => {
        await this.env.DB.prepare(
          "UPDATE media_assets SET status = 'completed', ai_result = ?, failure_reason = NULL, updated_at = ? WHERE id = ?",
        )
          .bind(aiResult, new Date().toISOString(), assetId)
          .run();
        return { persisted: true };
      });

      return { assetId, status: "completed" as const };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown workflow error";
      await this.env.DB.prepare(
        "UPDATE media_assets SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?",
      )
        .bind(reason.slice(0, 1_000), new Date().toISOString(), assetId)
        .run();
      throw error;
    }
  }
}

async function describeAsset(env: Env, asset: MediaRow): Promise<string> {
  if (!hasOpenAiGateway(env) && !env.AI && env.ENVIRONMENT === "development") {
    // Plain text can still be read without a model, which keeps local
    // development representative for document-heavy notes.
    if (asset.content_type.startsWith("text/")) {
      const object = await env.MEDIA_BUCKET.get(asset.object_key);
      if (object) return (await object.text()).slice(0, 20_000);
    }
    return asset.kind === "audio"
      ? `Local transcript placeholder for ${asset.original_name}`
      : `Local description placeholder for ${asset.original_name}`;
  }

  const object = await env.MEDIA_BUCKET.get(asset.object_key);
  if (!object) throw new Error(`Missing R2 object ${asset.object_key}`);
  const bytes = await object.arrayBuffer();

  if (asset.kind === "audio") {
    return transcribeAudio(env, bytes, asset.original_name, asset.content_type);
  }
  if (asset.kind === "image")
    return describeImage(env, bytes, asset.content_type);
  if (!env.AI) throw new Error("Workers AI document conversion is unavailable");
  return documentToText(env, asset.original_name, bytes, asset.content_type);
}

/* -------------------------------------------------------------------------- */
/*                          Note understanding pipeline                       */
/* -------------------------------------------------------------------------- */

const ROLE_BY_TYPE = {
  person: "with_person",
  place: "located_at",
  time: "happens_at",
  organization: "mentions",
  topic: "about",
} as const;

export class ProcessNoteWorkflow extends WorkflowEntrypoint<
  Env,
  ProcessNoteParams
> {
  async run(event: WorkflowEvent<ProcessNoteParams>, step: WorkflowStep) {
    const { noteId, userId } = event.payload;

    try {
      const note = await step.do("load note", async () => {
        const row = await this.env.DB.prepare(
          "SELECT * FROM notes WHERE id = ? AND user_id = ?",
        )
          .bind(noteId, userId)
          .first<NoteRow>();
        if (!row) throw new Error(`Unknown note ${noteId}`);
        await this.env.DB.prepare(
          "UPDATE notes SET status = 'processing', ai_error = NULL, updated_at = ? WHERE id = ?",
        )
          .bind(new Date().toISOString(), noteId)
          .run();
        return row;
      });

      /* ------------------------------ 1. media ----------------------------- */

      const media = await step.do(
        "read attachments",
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
        async () => {
          const { results } = await this.env.DB.prepare(
            "SELECT * FROM media_assets WHERE note_id = ? ORDER BY position ASC",
          )
            .bind(noteId)
            .all<MediaRow>();

          const hasAudio = results.some((asset) => asset.kind === "audio");
          const hasVisual = results.some((asset) => asset.kind !== "audio");
          await markStep(
            this.env,
            noteId,
            "transcribe",
            hasAudio ? "running" : "skipped",
            hasAudio ? null : "No audio in this note",
          );
          await markStep(
            this.env,
            noteId,
            "describe",
            hasVisual ? "running" : "skipped",
            hasVisual ? null : "No images or documents in this note",
          );

          const parts: string[] = [];
          for (const asset of results) {
            if (asset.status === "pending_upload") continue;
            try {
              const text = await describeAsset(this.env, asset);
              await this.env.DB.prepare(
                "UPDATE media_assets SET status = 'completed', ai_result = ?, failure_reason = NULL, updated_at = ? WHERE id = ?",
              )
                .bind(text, new Date().toISOString(), asset.id)
                .run();
              if (text) {
                parts.push(`[${asset.kind}: ${asset.original_name}]\n${text}`);
              }
            } catch (error) {
              const reason =
                error instanceof Error ? error.message : "Processing failed";
              await this.env.DB.prepare(
                "UPDATE media_assets SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?",
              )
                .bind(reason.slice(0, 500), new Date().toISOString(), asset.id)
                .run();
            }
          }

          if (hasAudio) {
            await markStep(
              this.env,
              noteId,
              "transcribe",
              "completed",
              `${results.filter((a) => a.kind === "audio").length} clip(s) transcribed`,
            );
          }
          if (hasVisual) {
            await markStep(
              this.env,
              noteId,
              "describe",
              "completed",
              `${results.filter((a) => a.kind !== "audio").length} file(s) read`,
            );
          }
          return parts;
        },
      );

      /* ---------------------------- 2. extraction -------------------------- */

      const extraction = await step.do(
        "extract structure",
        { retries: { limit: 2, delay: "15 seconds", backoff: "exponential" } },
        async (): Promise<Extraction> => {
          await markStep(this.env, noteId, "extract", "running");
          const composite = [
            note.title ? `# ${note.title}` : "",
            note.body_markdown,
            ...media,
          ]
            .filter(Boolean)
            .join("\n\n");

          const result = hasOpenAiGateway(this.env)
            ? await extractStructure(this.env, composite, note.created_at)
            : this.env.ENVIRONMENT === "development"
              ? heuristicExtraction(composite, note.created_at)
              : await extractStructure(this.env, composite, note.created_at);

          await markStep(
            this.env,
            noteId,
            "extract",
            "completed",
            `${result.people.length} people · ${result.places.length} places · ${result.times.length} dates`,
          );
          return result;
        },
      );

      /* --------------------------- 3. normalization ------------------------ */

      const entityIds = await step.do("resolve entities", async () => {
        await markStep(this.env, noteId, "resolve", "running");
        const ids: string[] = [];

        const link = async (
          input: Parameters<typeof resolveEntity>[2],
          confidence: number | null | undefined,
          mention: string | null | undefined,
        ) => {
          const entity = await resolveEntity(this.env, userId, input, "ai");
          await attachEntityToNote(this.env, noteId, entity.id, {
            role: ROLE_BY_TYPE[input.type],
            status: "suggested",
            origin: "ai",
            confidence: confidence ?? 0.6,
            mention: mention ?? null,
          });
          ids.push(entity.id);
        };

        for (const person of extraction.people) {
          await link(
            { type: "person", name: person.name },
            person.confidence,
            person.mention,
          );
        }
        for (const org of extraction.organizations) {
          await link(
            { type: "organization", name: org.name },
            org.confidence,
            org.mention,
          );
        }
        for (const place of extraction.places) {
          await link(
            {
              type: "place",
              name: place.name,
              address: place.address ?? null,
              latitude: place.latitude ?? null,
              longitude: place.longitude ?? null,
            },
            place.confidence,
            place.mention,
          );
        }
        for (const time of extraction.times) {
          await link(
            {
              type: "time",
              name: time.label,
              startsAt: time.startsAt ?? null,
              endsAt: time.endsAt ?? null,
              allDay: time.allDay ?? null,
              recurrence: time.recurrence ?? null,
            },
            time.confidence,
            time.mention,
          );
        }
        for (const topic of extraction.topics) {
          await link(
            { type: "topic", name: topic.name },
            topic.confidence,
            null,
          );
        }

        await markStep(
          this.env,
          noteId,
          "resolve",
          "completed",
          `${ids.length} entities linked`,
        );
        return ids;
      });

      /* ------------------------------ 4. linking --------------------------- */

      await step.do("connect notes", async () => {
        await markStep(this.env, noteId, "connect", "running");
        if (entityIds.length === 0) {
          await markStep(
            this.env,
            noteId,
            "connect",
            "completed",
            "No shared context found yet",
          );
          return { links: 0 };
        }

        const slots = entityIds.map(() => "?").join(", ");
        const { results } = await this.env.DB.prepare(
          `SELECT ne.note_id AS note_id, COUNT(DISTINCT ne.entity_id) AS shared
             FROM note_entities ne
             JOIN notes n ON n.id = ne.note_id
            WHERE ne.entity_id IN (${slots})
              AND ne.note_id <> ?
              AND n.user_id = ?
              AND ne.status <> 'rejected'
            GROUP BY ne.note_id
            HAVING shared >= 1
            ORDER BY shared DESC
            LIMIT 8`,
        )
          .bind(...entityIds, noteId, userId)
          .all<{ note_id: string; shared: number }>();

        const now = new Date().toISOString();
        for (const candidate of results) {
          // Confidence grows with how much context two notes genuinely share.
          const confidence = Math.min(0.95, 0.35 + candidate.shared * 0.2);
          await this.env.DB.prepare(
            `INSERT INTO note_links
               (id, user_id, source_note_id, target_note_id, relation, confidence, origin, status, reason, created_at)
             VALUES (?, ?, ?, ?, 'related', ?, 'ai', 'suggested', ?, ?)
             ON CONFLICT(source_note_id, target_note_id, relation)
             DO UPDATE SET confidence = excluded.confidence, reason = excluded.reason`,
          )
            .bind(
              crypto.randomUUID(),
              userId,
              noteId,
              candidate.note_id,
              confidence,
              `Shares ${candidate.shared} ${candidate.shared === 1 ? "entity" : "entities"}`,
              now,
            )
            .run();
        }

        await markStep(
          this.env,
          noteId,
          "connect",
          "completed",
          `${results.length} related note(s)`,
        );
        return { links: results.length };
      });

      /* ------------------------------ 5. finish ---------------------------- */

      await step.do("finalize", async () => {
        const primaryTime = extraction.times.find((time) => time.startsAt);
        const now = new Date().toISOString();
        await this.env.DB.prepare(
          `UPDATE notes
              SET status = 'ready',
                  ai_summary = ?,
                  ai_error = NULL,
                  title = COALESCE(NULLIF(title, ''), ?),
                  occurred_at = COALESCE(occurred_at, ?),
                  processed_at = ?,
                  updated_at = ?
            WHERE id = ?`,
        )
          .bind(
            extraction.summary ?? null,
            extraction.title ?? null,
            primaryTime?.startsAt ?? null,
            now,
            now,
            noteId,
          )
          .run();
        return { done: true };
      });

      return { noteId, status: "ready" as const };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown workflow error";
      await this.env.DB.prepare(
        "UPDATE notes SET status = 'failed', ai_error = ?, updated_at = ? WHERE id = ?",
      )
        .bind(reason.slice(0, 1_000), new Date().toISOString(), noteId)
        .run();
      await this.env.DB.prepare(
        "UPDATE note_processing_steps SET status = 'failed', detail = ?, finished_at = ? WHERE note_id = ? AND status IN ('pending', 'running')",
      )
        .bind(reason.slice(0, 500), new Date().toISOString(), noteId)
        .run();
      throw error;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Triggers                                  */
/* -------------------------------------------------------------------------- */

export class FireTriggerWorkflow extends WorkflowEntrypoint<
  Env,
  FireTriggerParams
> {
  async run(event: WorkflowEvent<FireTriggerParams>, step: WorkflowStep) {
    await step.sleepUntil(
      "wait for scheduled time",
      new Date(event.payload.scheduledFor),
    );
    return step.do("queue notification", async () => {
      const trigger = await this.env.DB.prepare(
        "SELECT user_id FROM triggers WHERE id = ? AND status = 'active'",
      )
        .bind(event.payload.triggerId)
        .first<{ user_id: string }>();
      if (!trigger) return { queued: false };
      await this.env.JOBS.send({
        type: "send-notification",
        triggerId: event.payload.triggerId,
        userId: trigger.user_id,
      });
      return { queued: true };
    });
  }
}
