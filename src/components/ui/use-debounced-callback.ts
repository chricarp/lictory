"use client";

import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCallback<T>(fn: (value: T) => void, delay: number) {
  const fnRef = useRef(fn);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (value: T) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => fnRef.current(value), delay);
    },
    [delay],
  );
}
