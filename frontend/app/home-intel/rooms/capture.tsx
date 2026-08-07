import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

const ROOM_TYPES = ["Kitchen", "Living Room", "Bedroom", "Bathroom", "Laundry Room", "Garage", "Basement", "Office", "Dining Room", "Hallway", "Closet", "Storage Room", "Workshop", "Exterior", "Other"];
const CONF_COLOR: Record<string, string> = { "Confirmed": colors.success, "Likely": colors.info, "Needs Confirmation": colors.warning };

export default function RoomCapture() {
  const router = useRouter();
  const [photo, setPhoto] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [roomType, setRoomType] = useState("");
  const [name, setName] = useState("");
  const [floorName, setFloorName] = useState("Main Floor");
  const [len, setLen] = useState(""); const [wid, setWid] = useState(""); const [ceil, setCeil] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<{ suggested_room_type: string; confidence_level: string } | null>(null);

  const addPhoto = () => {
    Alert.alert("Room photo", "Snap or choose a photo of the room", [
      { text: "Camera", onPress: async () => { const b = await takePhoto("Snap the room."); if (b) { setPhoto(b); classify(b); } } },
      { text: "Library", onPress: async () => { const b = await pickFromLibrary("Choose a room photo."); if (b) { setPhoto(b); classify(b); } } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const classify = async (b64?: string) => {
    const img = b64 || photo;
    if (!img && !description.trim()) { Alert.alert("Add a photo or description", "So Homie can suggest the room type."); return; }
    setClassifying(true);
    try {
      const s = await api<{ suggested_room_type: string; confidence_level: string }>("/hi/rooms/classify", { method: "POST", body: { photo_base64: img || undefined, description: description.trim() || undefined } });
      setSuggestion(s);
      if (!roomType) setRoomType(s.suggested_room_type);
      if (!name.trim()) setName(s.suggested_room_type);
    } catch (e: any) { Alert.alert("Couldn't identify", e?.message || "Pick the room type manually."); }
    finally { setClassifying(false); }
  };

  const save = async () => {
    const rt = roomType || "Other";
    if (!name.trim()) { Alert.alert("Name this room", "Give it a name you'll recognize."); return; }
    setSaving(true);
    try {
      const rm = await api<{ id: string }>("/hi/rooms", { method: "POST", body: {
        name: name.trim(), room_type: rt, floor_name: floorName.trim() || "Main Floor",
        classification_confidence: "Confirmed", cover_photo_base64: photo || undefined,
        approximate_length: len.trim() || undefined, approximate_width: wid.trim() || undefined,
        approximate_ceiling_height: ceil.trim() || undefined, notes: undefined,
        capture_type: photo ? "photo" : "manual_entry", description: description.trim() || undefined,
      } });
      router.replace(`/home-intel/rooms/connect?roomId=${rm.id}`);
    } catch (e: any) { Alert.alert("Couldn't save room", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Map a Room" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Pressable testID="cap-photo" style={styles.photoBox} onPress={addPhoto}>
            {photo ? <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photo} contentFit="cover" /> :
              <><MaterialCommunityIcons name="camera-plus-outline" size={28} color={colors.onSurfaceTertiary} /><Text style={styles.hint}>Add a room photo (optional)</Text></>}
          </Pressable>

          <Text style={styles.label}>What room is this? (optional description)</Text>
          <View style={styles.descRow}>
            <TextInput testID="cap-desc" style={styles.descInput} value={description} onChangeText={setDescription} placeholder="e.g. room with a stove and sink" placeholderTextColor={colors.onSurfaceTertiary} />
            <Pressable testID="cap-identify" style={styles.idBtn} onPress={() => classify()} disabled={classifying}>
              {classifying ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.idBtnText}>Identify</Text>}
            </Pressable>
          </View>

          {suggestion && (
            <View style={styles.suggestCard}>
              <Text style={styles.suggestText}>This appears to be your <Text style={{ fontFamily: font.bold }}>{suggestion.suggested_room_type}</Text>.</Text>
              <View style={[styles.confBadge, { borderColor: CONF_COLOR[suggestion.confidence_level] || colors.warning }]}>
                <Text style={[styles.confText, { color: CONF_COLOR[suggestion.confidence_level] || colors.warning }]}>{suggestion.confidence_level}</Text>
              </View>
              <Text style={styles.confirmHint}>Confirm below or pick a different type — nothing is saved until you confirm.</Text>
            </View>
          )}

          <Text style={styles.label}>Room type</Text>
          <View style={styles.chips}>
            {ROOM_TYPES.map((t) => (
              <Pressable key={t} testID={`cap-type-${t}`} style={[styles.chip, roomType === t && styles.chipOn]} onPress={() => { setRoomType(t); if (!name.trim()) setName(t); }}>
                <Text style={[styles.chipText, roomType === t && styles.chipTextOn]}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Room name</Text>
          <TextInput testID="cap-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Master Bedroom" placeholderTextColor={colors.onSurfaceTertiary} />
          <Text style={styles.label}>Floor</Text>
          <TextInput testID="cap-floor" style={styles.input} value={floorName} onChangeText={setFloorName} placeholder="Main Floor" placeholderTextColor={colors.onSurfaceTertiary} />

          <Text style={styles.label}>Approx. dimensions (optional — skip if unsure)</Text>
          <View style={styles.dimRow}>
            <TextInput testID="cap-len" style={[styles.input, styles.dim]} value={len} onChangeText={setLen} placeholder="Length" placeholderTextColor={colors.onSurfaceTertiary} />
            <TextInput testID="cap-wid" style={[styles.input, styles.dim]} value={wid} onChangeText={setWid} placeholder="Width" placeholderTextColor={colors.onSurfaceTertiary} />
            <TextInput testID="cap-ceil" style={[styles.input, styles.dim]} value={ceil} onChangeText={setCeil} placeholder="Ceiling" placeholderTextColor={colors.onSurfaceTertiary} />
          </View>

          <Pressable testID="cap-save" style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Confirm & Save Room</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  photoBox: { height: 150, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, borderStyle: "dashed", backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photo: { width: "100%", height: "100%" },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  descRow: { flexDirection: "row", gap: spacing.sm },
  descInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  idBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", minWidth: 80 },
  idBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  suggestCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  suggestText: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.lg },
  confBadge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3, marginTop: spacing.sm },
  confText: { fontFamily: font.bold, fontSize: type.sm },
  confirmHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  dimRow: { flexDirection: "row", gap: spacing.sm },
  dim: { flex: 1 },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
});
