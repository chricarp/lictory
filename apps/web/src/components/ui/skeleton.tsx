import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("skeleton-shimmer rounded-md", className)} {...props} />
  );
}
