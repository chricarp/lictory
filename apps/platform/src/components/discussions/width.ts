import { useEffect, useState } from "react";

// The laid-out width of an element (0 while it is hidden), following its
// resizes. Once the element leaves the document its last width is kept.
export function useElementWidth(element: HTMLElement | null) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      if (element.isConnected) setWidth(element.getBoundingClientRect().width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}
