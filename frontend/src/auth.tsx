import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, setToken, clearToken, getToken } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { reRegisterIfGranted } from "@/src/utils/push";

const REF_KEY = "diyhomie_ref";
function extractRef(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[#?&]ref=([^&]+)/);
  const v = m ? decodeURIComponent(m[1]) : null;
  // ignore non-referral markers (e.g. ?ref=blog used by SEO links)
  return v && /^[A-Za-z0-9]{4,12}$/.test(v) && v.toLowerCase() !== "blog" ? v.toUpperCase() : null;
}

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[#?&]session_id=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

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
  language?: string | null;
  credits: number;
  voice_minutes: number;
  subscription_tier: string;
  onboarded: boolean;
  is_admin?: boolean;
  avatar_base64?: string | null;
  bio?: string;
  share_public?: boolean;
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
  signInWithGoogle: () => Promise<User | null>;
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

  // Silently refresh push token on app open once a user is present (never prompts).
  useEffect(() => {
    if (user?.id) reRegisterIfGranted(user.id);
  }, [user?.id]);

  const processSessionId = useCallback(async (sessionId: string) => {
    const res = await api<{ access_token: string; user: User }>("/auth/google", {
      method: "POST",
      body: { session_id: sessionId },
      auth: false,
    });
    await setToken(res.access_token);
    setUserState(res.user);
    return res.user;
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    const redirectUrl = Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("auth");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return null;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type === "success" && result.url) {
      const sid = extractSessionId(result.url);
      if (sid) return await processSessionId(sid);
    }
    return null;
  }, [processSessionId]);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const r = extractRef(window.location.search) || extractRef(window.location.hash);
          if (r) { try { await storage.setItem(REF_KEY, r); } catch {} }
        } else if (Platform.OS !== "web") {
          const r = extractRef(await Linking.getInitialURL());
          if (r) { try { await storage.setItem(REF_KEY, r); } catch {} }
        }
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const path = window.location.pathname || "";
          const sid = extractSessionId(window.location.hash) || extractSessionId(window.location.search);
          // Stripe checkout returns ?session_id=cs_... on /billing/* — never a Google session.
          const isStripe = !!sid && (sid.startsWith("cs_") || path.startsWith("/billing"));
          if (sid && !isStripe) {
            await processSessionId(sid);
            window.history.replaceState(null, "", window.location.pathname);
            return;
          }
        } else if (Platform.OS !== "web") {
          const sid = extractSessionId(await Linking.getInitialURL());
          if (sid && !sid.startsWith("cs_")) {
            await processSessionId(sid);
            return;
          }
        }
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh, processSessionId]);

  const deviceInfo = () => ({
    platform: Platform.OS,
    device_name: Platform.select({ ios: "iPhone/iPad", android: "Android device", default: "Web browser" }),
  });

  const signIn = async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password, ...deviceInfo() },
      auth: false,
    });
    await setToken(res.access_token);
    setUserState(res.user);
    return res.user;
  };

  const signUp = async (email: string, password: string, name: string) => {
    let ref: string | null = null;
    try { ref = await storage.getItem<string>(REF_KEY, ""); } catch {}
    const res = await api<{ access_token: string; user: User }>("/auth/register", {
      method: "POST",
      body: { email, password, name, ...(ref ? { ref } : {}), ...deviceInfo() },
      auth: false,
    });
    await setToken(res.access_token);
    setUserState(res.user);
    try { await storage.removeItem(REF_KEY); } catch {}
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
    <Ctx.Provider value={{ user, loading, signIn, signUp, signOut, refresh, setUser: setUserState, updateProfile, signInWithGoogle }}>
      {children}
    </Ctx.Provider>
  );
}
