"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { AuthGate } from "@/components/shell/auth-gate";

function OpenApp() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/app");
  }, [router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-subtle">Opening your space…</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthGate>
      <OpenApp />
    </AuthGate>
  );
}
