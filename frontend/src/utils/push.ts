import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { api } from "@/src/api";

export type PushResult = { status: "granted" | "denied" | "unsupported" | "error"; canAskAgain?: boolean };

/**
 * Request notification permission (contextually), get the native device token,
 * and register it with the backend relay. Safe no-op on web / Expo Go.
 */
export async function registerForPush(userId: string): Promise<PushResult> {
  if (Platform.OS === "web") return { status: "unsupported" };
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    let canAskAgain = existing.canAskAgain;
    if (status !== "granted" && canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
      canAskAgain = req.canAskAgain;
    }
    if (status !== "granted") return { status: "denied", canAskAgain };

    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await api("/register-push", {
      method: "POST",
      auth: false,
      body: { user_id: userId, platform: Platform.OS, device_token: tokenResp.data },
    });
    return { status: "granted", canAskAgain };
  } catch {
    // Expo Go / simulator / no build — non-fatal.
    return { status: "error" };
  }
}

/**
 * Silent re-registration on app open — only registers if permission is ALREADY
 * granted (never prompts). Tokens can rotate, so we refresh them each open.
 */
export async function reRegisterIfGranted(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await api("/register-push", {
      method: "POST",
      auth: false,
      body: { user_id: userId, platform: Platform.OS, device_token: tokenResp.data },
    });
  } catch {
    // non-fatal
  }
}
