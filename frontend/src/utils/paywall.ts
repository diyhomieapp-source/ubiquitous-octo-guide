import { Platform, Alert } from "react-native";

/**
 * Show a "plan limit reached" prompt and route to the paywall on confirm.
 * `Alert.alert` is a no-op on react-native-web, so on web we fall back to
 * window.confirm() which is fully supported and gives the user real feedback.
 */
export function showLimitReached(router: { push: (href: any) => void }, title: string, message: string) {
  if (Platform.OS === "web") {
    const go = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}\n\nView plans now?`);
    if (go) router.push("/home-intel/upgrade");
    return;
  }
  Alert.alert(title, message, [
    { text: "Not now", style: "cancel" },
    { text: "See plans", onPress: () => router.push("/home-intel/upgrade") },
  ]);
}
