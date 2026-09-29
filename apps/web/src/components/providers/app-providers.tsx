"use client";

import { AuthProvider } from "./auth-provider";
import { RealtimeProvider } from "./realtime-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <AuthProvider><RealtimeProvider>{children}</RealtimeProvider></AuthProvider>;
}
