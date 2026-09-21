"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

export function useBrowserTimeZone() {
  return useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    () => "UTC",
  );
}
