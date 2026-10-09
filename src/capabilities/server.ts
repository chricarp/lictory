import "server-only";

import { after } from "next/server";
import { kickAiRuns } from "~/ai/runner";
import { db } from "~/db";
import { deliveryProviders } from "~/delivery/registry";
import {
  trackPublicationCompleted,
  trackServer,
  trackServerFailure,
} from "~/lib/analytics/server";
import { kickNotificationEmails } from "~/notifications/email";
import { storage } from "~/storage";
import type { CapabilityContext, Effects, Principal } from "./core";

// Wires capabilities to this deployment: the application database, object
// storage, delivery adapters, analytics and background work.
export function serverEffects(
  principal: Principal,
  headers?: Headers,
): Effects {
  return {
    track: (event, properties, key) =>
      trackServer(principal.userId, event, properties, headers, key),
    trackFailure: (operation, error) =>
      trackServerFailure(principal.userId, operation, error, headers),
    notificationsQueued: () => kickNotificationEmails(db),
    // Lictory Intelligence may take minutes; run it after the response is sent.
    aiRunsQueued: () => after(() => kickAiRuns(db)),
    publicationCompleted: (publication) =>
      trackPublicationCompleted(publication, headers),
  };
}

export function serverContext(
  principal: Principal,
  headers?: Headers,
): CapabilityContext {
  return {
    db,
    principal,
    effects: serverEffects(principal, headers),
    storage,
    deliveryProviders: deliveryProviders(),
  };
}
