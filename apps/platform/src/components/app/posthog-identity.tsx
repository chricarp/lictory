"use client";
import { useEffect } from "react";
import { identifyUser } from "@lictory/core/lib/analytics/client";
export function PostHogIdentity({ userId }: { userId: string }) {
  useEffect(() => {
    identifyUser(userId);
  }, [userId]);
  return null;
}
