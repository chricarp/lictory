import Link from "next/link";
import { CircleAlert } from "lucide-react";

import { Button } from "~/components/ui/button";

export default async function AuthErrorPage({
  searchParams,
}: PageProps<"/auth-error">) {
  const params = await searchParams;
  const message =
    typeof params.error === "string"
      ? params.error.replaceAll("_", " ")
      : "The authentication request could not be completed.";

  return (
    <div className="grid gap-6 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <CircleAlert className="size-7" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign-in interrupted
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground capitalize">
          {message}
        </p>
      </div>
      <Link href="/sign-in" className="contents">
        <Button className="w-full">Try again</Button>
      </Link>
    </div>
  );
}
