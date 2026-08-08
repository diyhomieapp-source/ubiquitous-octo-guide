import { Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "@/src/api";

const APP_VERSION = (Constants.expoConfig?.version as string) || "1.0.0";

/**
 * Fire-and-forget product event. Forwards to the backend, which strips
 * disallowed data, honours the user's opt-out, and relays to PostHog.
 * Analytics must never break product behaviour, so this never throws.
 */
export async function track(event: string, properties: Record<string, any> = {}) {
  try {
    await api("/hi/analytics/track", {
      method: "POST",
      body: { event, properties, app_version: APP_VERSION, platform: Platform.OS },
    });
  } catch {}
}

export async function getFlags(): Promise<Record<string, boolean>> {
  try {
    const r = await api<{ flags: Record<string, boolean> }>("/hi/analytics/flags");
    return r.flags || {};
  } catch {
    return {};
  }
}
