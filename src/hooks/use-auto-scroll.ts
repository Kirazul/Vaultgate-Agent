"use client";
import { useCallback, useEffect, useRef } from "react";

/**
 * Scroll-anchored auto-scroll with snap-back behavior.
 *
 * - Sticks to the bottom while the user is near the bottom.
 * - If the user scrolls up to read, it stops fighting them — and stays out of
 *   the way even when the stream ends (no surprise yank to the bottom).
 * - Snaps back to bottom when streaming ends ONLY if the user was already
 *   following along at the bottom.
 * - Exposes scrollToBottom() for explicit user-intent triggers (composer focus).
 *
 * Programmatic scrolls are tagged so the user-intent detector never mistakes our
 * own pin for the user scrolling away, which used to flip the stick state and
 * cause the view to jump.
 */
const STICK_THRESHOLD_PX = 120;

export function useAutoScroll(dep: unknown, { wasStreaming }: { wasStreaming?: boolean } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const wasStreamingRef = useRef(false);
  // Set just before a programmatic scroll so the scroll listener can ignore the
  // resulting event instead of treating it as the user scrolling away.
  const programmaticRef = useRef(false);

  const isNearBottom = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;

  const pinToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = containerRef.current;
    if (!el) return;
    programmaticRef.current = true;
    if (behavior === "smooth") el.scrollTo({ top: el.scrollHeight, behavior });
    else el.scrollTop = el.scrollHeight;
    // Release the guard after the scroll settles. rAF covers instant scrolls;
    // the timeout covers the tail of a smooth animation.
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmaticRef.current) return; // our own pin, not user intent
      stickRef.current = isNearBottom(el);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Normal dep-driven scroll (during streaming). Instant so it tracks new tokens
  // tightly without a smooth animation fighting the next frame's content.
  useEffect(() => {
    if (stickRef.current) pinToBottom("auto");
  }, [dep, pinToBottom]);

  // Keep the view pinned while content grows or the container resizes (e.g. the
  // workspace panel opening, window resize, late image/diff layout). Without
  // this, growth after the last token-flush can leave the newest text scrolled
  // out of view behind the sticky header.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) pinToBottom("auto");
    });
    observer.observe(el);
    const inner = el.firstElementChild;
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
  }, [pinToBottom]);

  // Snap back to bottom when streaming ends — but only if the user was following
  // along. If they scrolled up to read, leave them exactly where they are.
  useEffect(() => {
    if (wasStreamingRef.current && !wasStreaming && stickRef.current) {
      requestAnimationFrame(() => pinToBottom("smooth"));
    }
    wasStreamingRef.current = wasStreaming ?? false;
  }, [wasStreaming, pinToBottom]);

  const scrollToBottom = useCallback(() => {
    stickRef.current = true;
    pinToBottom("smooth");
  }, [pinToBottom]);

  return { containerRef, scrollToBottom };
}
