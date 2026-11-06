import { useEffect, useState } from "react";

// Whether an element is laid out: the comments column beside a page is
// hidden by a container query on narrow frames, where comments open as a
// sheet instead.
export function useLaidOut(element: HTMLElement | null) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element) return;
    const check = () => setVisible(element.getClientRects().length > 0);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [element]);
  return Boolean(element) && visible;
}
