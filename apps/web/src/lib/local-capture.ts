"use client";

import * as React from "react";

export type LocalCaptureAttachment = {
  localId: string;
  file: File;
  fileName: string;
  bytes: number;
  contentType: string;
  durationSeconds: number | null;
  kind: "image" | "audio" | "document";
};

const STORAGE_PREFIX = "lictory.capture.v1";
const DATABASE_NAME = "lictory-local-capture";
const DATABASE_VERSION = 1;
const ATTACHMENTS_STORE = "attachments";
const CHANGE_EVENT = "lictory-local-capture-change";

function bodyKey(userId: string) {
  return `${STORAGE_PREFIX}.${userId}.body`;
}

function attachmentCountKey(userId: string) {
  return `${STORAGE_PREFIX}.${userId}.attachment-count`;
}

function notify(userId: string) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: userId }));
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ATTACHMENTS_STORE)) {
        request.result.createObjectStore(ATTACHMENTS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function readLocalCaptureBody(userId: string) {
  return window.localStorage.getItem(bodyKey(userId)) ?? "";
}

export function writeLocalCaptureBody(userId: string, body: string) {
  if (body.length > 0) window.localStorage.setItem(bodyKey(userId), body);
  else window.localStorage.removeItem(bodyKey(userId));
  notify(userId);
}

export async function readLocalCaptureAttachments(userId: string) {
  const database = await openDatabase();
  try {
    return await new Promise<LocalCaptureAttachment[]>((resolve, reject) => {
      const request = database
        .transaction(ATTACHMENTS_STORE, "readonly")
        .objectStore(ATTACHMENTS_STORE)
        .get(userId);
      request.onsuccess = () =>
        resolve((request.result as LocalCaptureAttachment[] | undefined) ?? []);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function writeLocalCaptureAttachments(
  userId: string,
  attachments: LocalCaptureAttachment[],
) {
  if (attachments.length > 0) {
    window.localStorage.setItem(
      attachmentCountKey(userId),
      String(attachments.length),
    );
  } else {
    window.localStorage.removeItem(attachmentCountKey(userId));
  }
  notify(userId);

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ATTACHMENTS_STORE, "readwrite");
      const store = transaction.objectStore(ATTACHMENTS_STORE);
      if (attachments.length > 0) store.put(attachments, userId);
      else store.delete(userId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function clearLocalCapture(userId: string) {
  window.localStorage.removeItem(bodyKey(userId));
  await writeLocalCaptureAttachments(userId, []);
}

function hasLocalCapture(userId?: string) {
  if (!userId || typeof window === "undefined") return false;
  const body = window.localStorage.getItem(bodyKey(userId)) ?? "";
  const attachmentCount = Number(
    window.localStorage.getItem(attachmentCountKey(userId)) ?? "0",
  );
  return body.trim().length > 0 || attachmentCount > 0;
}

export function useHasLocalCapture(userId?: string) {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => {
        const onChange = (event: Event) => {
          if (
            event instanceof CustomEvent &&
            event.detail !== undefined &&
            event.detail !== userId
          ) {
            return;
          }
          listener();
        };
        window.addEventListener(CHANGE_EVENT, onChange);
        window.addEventListener("storage", onChange);
        return () => {
          window.removeEventListener(CHANGE_EVENT, onChange);
          window.removeEventListener("storage", onChange);
        };
      },
      [userId],
    ),
    React.useCallback(() => hasLocalCapture(userId), [userId]),
    () => false,
  );
}
