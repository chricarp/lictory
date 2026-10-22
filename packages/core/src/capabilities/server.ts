import { db } from "@lictory/core/db";
import { deliveryProviders } from "@lictory/core/delivery/registry";
import {
  trackPublicationCompleted,
  trackServer,
  trackServerFailure,
} from "@lictory/core/lib/analytics/server";
import { storage } from "@lictory/core/storage";
import type {
  CapabilityContext,
  Effects,
  Principal,
} from "@lictory/core/capabilities/core";

// Wires capabilities to this deployment: the application database, object
// storage, delivery adapters and analytics.
export function serverEffects(
  principal: Principal,
  headers?: Headers,
): Effects {
  return {
    track: (event, properties, key) =>
      trackServer(principal.userId, event, properties, headers, key),
    trackFailure: (operation, error) =>
      trackServerFailure(principal.userId, operation, error, headers),
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
