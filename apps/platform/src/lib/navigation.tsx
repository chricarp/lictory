import {
  useLocation,
  useParams as useRouteParams,
  useRouter as useTanStackRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  createContext,
  forwardRef,
  useContext,
  useLayoutEffect,
  useMemo,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from "react";

// Components navigate with plain hrefs (built by `paths`), so routing stays a
// detail of the route tree rather than of every link.

type NavigateOptions = { scroll?: boolean };
type HrefOptions = { href: string; replace?: boolean; resetScroll?: boolean };
type AnyRouter = ReturnType<typeof useTanStackRouter>;

// The router's typed options describe route templates; a built href is
// equally valid at runtime (`href` takes precedence over `to`).
function navigate(router: AnyRouter, options: HrefOptions) {
  return router.navigate(
    options as unknown as Parameters<AnyRouter["navigate"]>[0],
  );
}
function preload(router: AnyRouter, href: string) {
  return router
    .preloadRoute({ href } as unknown as Parameters<
      AnyRouter["preloadRoute"]
    >[0])
    .catch(() => undefined);
}

export function useRouter() {
  const router = useTanStackRouter();
  return useMemo(
    () => ({
      push: (href: string, options?: NavigateOptions) =>
        void navigate(router, { href, resetScroll: options?.scroll !== false }),
      replace: (href: string, options?: NavigateOptions) =>
        void navigate(router, {
          href,
          replace: true,
          resetScroll: options?.scroll !== false,
        }),
      back: () => router.history.back(),
      preload: (href: string) => void preload(router, href),
    }),
    [router],
  );
}

// Replaces the current entry with `href` once rendered.
export function Redirect({ href }: { href: string }) {
  const router = useTanStackRouter();
  useLayoutEffect(() => {
    void navigate(router, { href, replace: true });
  }, [router, href]);
  return null;
}

export function usePathname() {
  return useLocation({ select: (l) => l.pathname });
}

// Raw query string values, exactly as in the address bar.
export function useSearchParams() {
  const search = useLocation({ select: (l) => l.searchStr });
  return useMemo(() => new URLSearchParams(search), [search]);
}

const looseParams = useRouteParams as unknown as (options: {
  strict: false;
}) => Record<string, string | undefined>;
// Every path parameter of the current location (org, project, id, ...).
export function useParams<
  T extends Record<string, string | undefined>,
>(): Partial<T> {
  return looseParams({ strict: false }) as Partial<T>;
}

const LinkStatusContext = createContext({ pending: false });
// Whether the navigation started by the enclosing Link is still loading.
export function useLinkStatus() {
  return useContext(LinkStatusContext);
}

function samePath(a: string, b: string) {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export type LinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  href: string;
  replace?: boolean;
  // false keeps the scroll position (filters, tabs within a page).
  scroll?: boolean;
  // Preload the route's code on intent (default) or never.
  prefetch?: boolean | null;
};

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    href,
    replace,
    scroll,
    prefetch,
    onClick,
    onMouseEnter,
    onFocus,
    onTouchStart,
    target,
    children,
    ...props
  },
  ref,
) {
  const router = useTanStackRouter();
  const pending = useRouterState({
    select: (s) =>
      s.status === "pending" &&
      samePath(s.location.pathname, href.split(/[?#]/)[0] ?? ""),
  });
  const internal = href.startsWith("/") && !href.startsWith("//");
  const warm = () => {
    if (internal && prefetch !== false) void preload(router, href);
  };
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      !internal ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== "_self") ||
      props.download !== undefined
    )
      return;
    event.preventDefault();
    void navigate(router, { href, replace, resetScroll: scroll !== false });
  };
  const status = useMemo(() => ({ pending }), [pending]);
  return (
    <a
      {...props}
      ref={ref}
      href={href}
      target={target}
      onClick={click}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        warm();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        warm();
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        warm();
      }}
    >
      <LinkStatusContext.Provider value={status}>
        {children}
      </LinkStatusContext.Provider>
    </a>
  );
});
