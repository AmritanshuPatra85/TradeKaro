"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

type AuthContextValue = { session: Session | null; loading: boolean; error: string | null; signIn: () => Promise<void>; signInAsGuest: () => Promise<void>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoading(false); });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const signIn = useCallback(async () => {
    setError(null);
    if (!supabase) { setError("Configure the public Supabase URL and anon key for the web app."); return; }
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (authError) setError(authError.message);
  }, [supabase, setError]);
  const signInAsGuest = useCallback(async () => {
    setError(null);
    if (!supabase) { setError("Configure the public Supabase URL and anon key for the web app."); return; }
    const { error: authError } = await supabase.auth.signInAnonymously();
    if (authError) setError(authError.message);
  }, [supabase, setError]);
  const signOut = useCallback(async () => { if (supabase) await supabase.auth.signOut(); }, [supabase]);
  const value = useMemo(() => ({ session, loading, error, signIn, signInAsGuest, signOut }), [session, loading, error, signIn, signInAsGuest, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
