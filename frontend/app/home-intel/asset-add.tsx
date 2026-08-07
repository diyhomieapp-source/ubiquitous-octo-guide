import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

const CATEGORIES = ["Appliance", "HVAC", "Plumbing", "Electrical", "Water Heater", "Roofing", "Flooring", "Other"];

export default function AssetAddScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { roomId, roomName } = useLocalSearchParams<{ roomId?: string; roomName?: string }>();
  const editing = !!id;

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Appliance");
  const [room, setRoom] = useState(roomName ? decodeURIComponent(roomName) : "");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [installDate, setInstallDate] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  const load = useCallback(async () => {
    if (!editing) return;
    try {
      const d = await api<{ asset: any }>(`/hi/assets/${id}`);
      const a = d.asset;
      setName(a.name || ""); setCategory(a.category || "Appliance"); setRoom(a.room_name === "Unassigned" ? "" : (a.room_name || ""));
      setBrand(a.brand || ""); setModel(a.model_number || ""); setInstallDate(a.installation_date || "");
      setPhoto(a.photo_base64 || null);
    } catch {} finally { setLoaded(true); }
  }, [editing, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addPhoto = () => {
    Alert.alert("Add photo", "Choose a source", [
      { text: "Camera", onPress: async () => { const b = await takePhoto("Snap a photo of this asset."); if (b) setPhoto(b); } },
      { text: "Library", onPress: async () => { const b = await pickFromLibrary("Choose a photo of this asset."); if (b) setPhoto(b); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name required", "Give this asset a name."); return; }
    setSaving(true);
    const body: any = { name: name.trim(), category, room_id: (!editing && roomId) ? roomId : undefined, room_name: room.trim() || undefined, brand: brand.trim() || undefined, model_number: model.trim() || undefined, installation_date: installDate.trim() || undefined };
    if (photo) body.photo_base64 = photo;
    try {
      if (editing) {
        await api(`/hi/assets/${id}`, { method: "PUT", body });
        router.back();
      } else {
        const a = await api<{ id: string }>("/hi/assets", { method: "POST", body });
        router.replace(`/home-intel/asset/${a.id}`);
      }
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  if (!loaded) return <View style={styles.root}><ScreenHeader title="Add Asset" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title={editing ? "Edit Asset" : "Add Asset"} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Pressable testID="hi-asset-photo" style={styles.photoBox} onPress={addPhoto}>
            {photo ? <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photo} contentFit="cover" /> :
              <><MaterialCommunityIcons name="camera-plus-outline" size={28} color={colors.onSurfaceTertiary} /><Text style={styles.photoHint}>Add photo (optional)</Text></>}
          </Pressable>

          <Field label="Asset name *"><TextInput testID="hi-field-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Kitchen Refrigerator" placeholderTextColor={colors.onSurfaceTertiary} /></Field>

          <Text style={styles.label}>Category</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} testID={`hi-cat-${c}`} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}>
                <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text>
              </Pressable>
            ))}
          </View>

          <Field label="Room"><TextInput testID="hi-field-room" style={styles.input} value={room} onChangeText={setRoom} placeholder="e.g. Kitchen, Basement" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
          <Field label="Brand"><TextInput testID="hi-field-brand" style={styles.input} value={brand} onChangeText={setBrand} placeholder="e.g. Whirlpool" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
          <Field label="Model number"><TextInput testID="hi-field-model" style={styles.input} value={model} onChangeText={setModel} placeholder="e.g. WRF535SWHZ" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
          <Field label="Installation date"><TextInput testID="hi-field-install" style={styles.input} value={installDate} onChangeText={setInstallDate} placeholder="e.g. 2021 or 2021-06" placeholderTextColor={colors.onSurfaceTertiary} /></Field>

          <Pressable testID="hi-save-asset" style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>{editing ? "Save changes" : "Save asset"}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <><Text style={styles.label}>{label}</Text>{children}</>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  photoBox: { height: 140, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, borderStyle: "dashed", backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, overflow: "hidden" },
  photo: { width: "100%", height: "100%" },
  photoHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
});
