import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

const CATS = ["Tool", "Material", "Supply", "Safety", "Hardware", "Paint", "Other"];
const STATUSES = [{ k: "have", l: "Have plenty" }, { k: "low", l: "Running low" }, { k: "out", l: "Out" }];

export default function AddInventory() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Tool");
  const [brand, setBrand] = useState("");
  const [quantity, setQuantity] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("have");
  const [photo, setPhoto] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [saving, setSaving] = useState(false);

  const runIdentify = async (b: string) => {
    setPhoto(b); setIdentifying(true);
    try {
      const r = await api<{ identification: any }>("/hi/inventory/identify", { method: "POST", body: { image_base64: b } });
      const id = r.identification || {};
      if (id.name) setName(id.name);
      if (id.category && CATS.includes(id.category)) setCategory(id.category);
      if (id.brand) setBrand(id.brand);
      if (id.quantity) setQuantity(String(id.quantity));
      if (id.name) Alert.alert("Identified", `Looks like: ${id.name}${id.confidence ? ` (${id.confidence} confidence)` : ""}. Edit anything below.`);
    } catch { Alert.alert("Couldn't identify", "Add the details manually."); }
    finally { setIdentifying(false); }
  };

  const attach = () => {
    Alert.alert("Add a photo", "Homie can identify the item for you", [
      { text: "Camera", onPress: async () => { const b = await takePhoto("Snap the tool or supply."); if (b) runIdentify(b); } },
      { text: "Library", onPress: async () => { const b = await pickFromLibrary("Choose a photo."); if (b) runIdentify(b); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name it", "Give the item a name."); return; }
    setSaving(true);
    try {
      await api("/hi/inventory", { method: "POST", body: {
        name: name.trim(), category, brand: brand.trim() || undefined, quantity: quantity.trim() || undefined,
        storage_location: location.trim() || undefined, status, photo_base64: photo || undefined,
      } });
      router.back();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Add to Toolbox" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Pressable testID="inv-photo" style={styles.photoBox} onPress={attach}>
            {photo ? <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photo} contentFit="cover" /> : (
              <View style={styles.photoPlaceholder}>
                <MaterialCommunityIcons name="camera-plus-outline" size={28} color={colors.brandPrimary} />
                <Text style={styles.photoText}>Add a photo — Homie will identify it</Text>
              </View>
            )}
            {identifying && <View style={styles.idOverlay}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.idText}>Identifying…</Text></View>}
          </Pressable>

          <Text style={styles.label}>Name</Text>
          <TextInput testID="inv-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Cordless drill" placeholderTextColor={colors.onSurfaceTertiary} />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chips}>{CATS.map((c) => (<Pressable key={c} testID={`inv-addcat-${c}`} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}><Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text></Pressable>))}</View>

          <Text style={styles.label}>Brand (optional)</Text>
          <TextInput testID="inv-brand" style={styles.input} value={brand} onChangeText={setBrand} placeholder="e.g. DeWalt" placeholderTextColor={colors.onSurfaceTertiary} />
          <Text style={styles.label}>Quantity (optional)</Text>
          <TextInput testID="inv-qty" style={styles.input} value={quantity} onChangeText={setQuantity} placeholder="e.g. 1, or 2 boxes" placeholderTextColor={colors.onSurfaceTertiary} />
          <Text style={styles.label}>Where is it stored? (optional)</Text>
          <TextInput testID="inv-loc" style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. Garage shelf" placeholderTextColor={colors.onSurfaceTertiary} />

          <Text style={styles.label}>How much do you have?</Text>
          <View style={styles.chips}>{STATUSES.map((s) => (<Pressable key={s.k} testID={`inv-status-${s.k}`} style={[styles.chip, status === s.k && styles.chipOn]} onPress={() => setStatus(s.k)}><Text style={[styles.chipText, status === s.k && styles.chipTextOn]}>{s.l}</Text></Pressable>))}</View>

          <Pressable testID="inv-save" style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Add to toolbox</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  photoBox: { height: 160, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surfaceSecondary, overflow: "hidden", justifyContent: "center" },
  photo: { width: "100%", height: "100%" },
  photoPlaceholder: { alignItems: "center", gap: spacing.sm },
  photoText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  idOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000AA", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  idText: { color: "#fff", fontFamily: font.medium, fontSize: type.sm },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
});
