import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

const ROOM_TYPES = ["Kitchen", "Living Room", "Bedroom", "Bathroom", "Laundry Room", "Garage", "Basement", "Office", "Dining Room", "Hallway", "Closet", "Storage Room", "Workshop", "Exterior", "Other"];

export default function RoomUpdate() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState(""); const [roomType, setRoomType] = useState("Other");
  const [notes, setNotes] = useState(""); const [photo, setPhoto] = useState<string | null>(null);
  const [len, setLen] = useState(""); const [wid, setWid] = useState(""); const [ceil, setCeil] = useState("");
  const [loaded, setLoaded] = useState(false); const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ room: any }>(`/hi/rooms/${id}/profile`);
      const rm = d.room;
      setName(rm.name || ""); setRoomType(rm.room_type || "Other"); setNotes(rm.notes || "");
      setPhoto(rm.cover_photo_base64 || null); setLen(rm.approximate_length || ""); setWid(rm.approximate_width || ""); setCeil(rm.approximate_ceiling_height || "");
    } catch {} finally { setLoaded(true); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addPhoto = () => {
    Alert.alert("Cover photo", "Update the room photo", [
      { text: "Camera", onPress: async () => { const b = await takePhoto("Snap the room."); if (b) setPhoto(b); } },
      { text: "Library", onPress: async () => { const b = await pickFromLibrary("Choose a photo."); if (b) setPhoto(b); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name required", "Give the room a name."); return; }
    setSaving(true);
    try {
      await api(`/hi/rooms/${id}`, { method: "PUT", body: {
        name: name.trim(), room_type: roomType, notes: notes,
        cover_photo_base64: photo || undefined,
        approximate_length: len.trim(), approximate_width: wid.trim(), approximate_ceiling_height: ceil.trim(),
      } });
      router.back();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  if (!loaded) return <View style={styles.root}><ScreenHeader title="Update Room" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Update Room" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Pressable testID="upd-photo" style={styles.photoBox} onPress={addPhoto}>
            {photo ? <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photo} contentFit="cover" /> :
              <><MaterialCommunityIcons name="camera-plus-outline" size={26} color={colors.onSurfaceTertiary} /><Text style={styles.hint}>Update photo</Text></>}
          </Pressable>
          <Text style={styles.note}>Renaming or changing the room type keeps all assets, issues, documents and history.</Text>

          <Text style={styles.label}>Room name</Text>
          <TextInput testID="upd-name" style={styles.input} value={name} onChangeText={setName} placeholderTextColor={colors.onSurfaceTertiary} />
          <Text style={styles.label}>Room type</Text>
          <View style={styles.chips}>
            {ROOM_TYPES.map((t) => (
              <Pressable key={t} testID={`upd-type-${t}`} style={[styles.chip, roomType === t && styles.chipOn]} onPress={() => setRoomType(t)}>
                <Text style={[styles.chipText, roomType === t && styles.chipTextOn]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Notes</Text>
          <TextInput testID="upd-notes" style={[styles.input, { minHeight: 80 }]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" placeholder="Optional notes" placeholderTextColor={colors.onSurfaceTertiary} />
          <Text style={styles.label}>Approx. dimensions</Text>
          <View style={styles.dimRow}>
            <TextInput testID="upd-len" style={[styles.input, styles.dim]} value={len} onChangeText={setLen} placeholder="Length" placeholderTextColor={colors.onSurfaceTertiary} />
            <TextInput testID="upd-wid" style={[styles.input, styles.dim]} value={wid} onChangeText={setWid} placeholder="Width" placeholderTextColor={colors.onSurfaceTertiary} />
            <TextInput testID="upd-ceil" style={[styles.input, styles.dim]} value={ceil} onChangeText={setCeil} placeholder="Ceiling" placeholderTextColor={colors.onSurfaceTertiary} />
          </View>
          <Pressable testID="upd-save" style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save changes</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  photoBox: { height: 130, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, borderStyle: "dashed", backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photo: { width: "100%", height: "100%" },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  dimRow: { flexDirection: "row", gap: spacing.sm },
  dim: { flex: 1 },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
});
