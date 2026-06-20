import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setToken, clearToken, getToken } from "@/src/api";

export type User = {
  id: string;
  email: string;
  name: string;
  experience: string | null;
  tools: string[];
  budget: string | null;
  pain_point: string | null;
  expectation: string | null;
  location: string;
  credits: number;
  voice_minutes: number;
  subscription_tier: string;
  onboarded: boolean;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (email: string, password: string, name: string) => Promise<User>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
  updateProfile: (patch: Partial<User>) => Promise<User>;
};

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setUserState(null);
        return;
      }
      const me = await api<User>("/auth/me");
      setUserState(me);
    } catch {
      setUserState(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const signIn = async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    await setToken(res.access_token);
    setUserState(res.user);
    return res.user;
  };

  const signUp = async (email: string, password: string, name: string) => {
    const res = await api<{ access_token: string; user: User }>("/auth/register", {
      method: "POST",
      body: { email, password, name },
      auth: false,
    });
    await setToken(res.access_token);
    setUserState(res.user);
    return res.user;
  };

  const signOut = async () => {
    await clearToken();
    setUserState(null);
  };

  const updateProfile = async (patch: Partial<User>) => {
    const updated = await api<User>("/profile", { method: "PUT", body: patch });
    setUserState(updated);
    return updated;
  };

  return (
    <Ctx.Provider value={{ user, loading, signIn, signUp, signOut, refresh, setUser: setUserState, updateProfile }}>
      {children}
    </Ctx.Provider>
  );
}
