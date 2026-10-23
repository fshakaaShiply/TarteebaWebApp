"use client";

import { createContext, useContext, useEffect, useRef } from "react";

/*
 * Focus on the booking page after an action removes its own control (Confirm, Reject and Cancel change the status;
 * assigning the last cleaners removes the picker): instead of falling to <body>, focus goes to the booking's heading
 * (or the visit's), so keyboard and screen-reader users keep their place.
 */

const FocusFallback = createContext<HTMLElement | null>(null);

/** Provides the element dialogs return focus to when the control that opened them is gone (the booking heading). */
export const BookingFocusProvider = FocusFallback.Provider;

/** The booking page's focus fallback for `returnFocusTo` (null outside the page, e.g. isolated tests). */
export function useBookingFocusFallback(): HTMLElement | null {
  return useContext(FocusFallback);
}

/**
 * When `key` changes and that update removed the control that had focus (focus fell to <body>), focus `target`. This
 * covers removals that land after a dialog closed (a refetch), which `returnFocusTo` cannot see. A click on the page
 * background (the last focused control is still there) is left alone.
 */
export function useFocusRescue(target: HTMLElement | null, key: unknown) {
  const lastFocused = useRef<Element | null>(null);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      lastFocused.current = event.target instanceof Element ? event.target : null;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const lastKey = useRef(key);
  useEffect(() => {
    if (Object.is(lastKey.current, key)) return;
    lastKey.current = key;
    const removed = lastFocused.current !== null && !lastFocused.current.isConnected;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (removed && lost && target?.isConnected) target.focus();
  }, [target, key]);
}
