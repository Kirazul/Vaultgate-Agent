"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Keep a component mounted through its exit animation.
 *
 * Returns `{ mounted, closing }`: render whenever `mounted` is true, and apply
 * your exit classes while `closing` is true. The component stays in the tree for
 * `exitMs` after `open` flips to false so a slide/fade-out can play instead of
 * the element snapping away (the old "jumpy" close).
 */
export function useMountTransition(open: boolean, exitMs = 200): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      timer.current = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, exitMs);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, exitMs, mounted]);

  return { mounted, closing };
}
