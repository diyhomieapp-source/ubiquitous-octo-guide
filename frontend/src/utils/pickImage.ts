import { Alert, Linking, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";

async function ensurePerm(kind: "camera" | "library", reason: string): Promise<boolean> {
  const get = kind === "camera" ? ImagePicker.getCameraPermissionsAsync : ImagePicker.getMediaLibraryPermissionsAsync;
  const ask = kind === "camera" ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync;
  let perm = await get();
  if (perm.granted) return true;
  if (perm.canAskAgain) perm = await ask();
  if (perm.granted) return true;
  Alert.alert(
    kind === "camera" ? "Camera access needed" : "Photo access needed",
    reason,
    [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }],
  );
  return false;
}

/** Returns base64 (no data: prefix) or null if cancelled. */
export async function pickFromLibrary(reason = "Allow access to choose a photo."): Promise<string | null> {
  if (!(await ensurePerm("library", reason))) return null;
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, base64: true, quality: 0.6 });
  if (!res.canceled && res.assets?.[0]?.base64) return res.assets[0].base64;
  return null;
}

export async function takePhoto(reason = "Allow camera access to snap a photo."): Promise<string | null> {
  if (Platform.OS === "web") return pickFromLibrary(reason);
  if (!(await ensurePerm("camera", reason))) return null;
  const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, base64: true, quality: 0.6 });
  if (!res.canceled && res.assets?.[0]?.base64) return res.assets[0].base64;
  return null;
}
