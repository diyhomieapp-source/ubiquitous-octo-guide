import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

const CATS = ["manual", "receipt", "warranty", "estimate", "invoice", "permit", "inspection_report", "product_label", "project_photo", "other"];
type Asset = { id: string; name: string };

export default function AddDocument() {
  const router = useRouter();
  const { assetId } = useLocalSearchParams<{ assetId?: string }>();
  const [photo, setPhoto] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("manual");
  const [linkAsset, setLinkAsset] = useState<string | null>(assetId || null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ assets: Asset[] }>("/hi/assets"); setAssets(d.assets); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addPhoto = () => {
    Alert.alert("Add document", "Scan or choose the document", [
      { text: "Camera scan", onPress: async () => { const b = await takePhoto("Scan the document."); if (b) setPhoto(b); } },
      { text: "Photo library", onPress: async () => { const b = await pickFromLibrary("Choose the document."); if (b) setPhoto(b); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const upload = async () => {
    if (!photo) { Alert.alert("Add a file", "Scan or choose a document photo first."); return; }
    setUploading(true);
    try {
      const res = await api<{ id: string; extracted_fields: number }>("/hi/documents", { method: "POST", body: {
        title: title.trim() || undefined, category, file_base64: photo, file_type: "image", is_image: true,
        asset_id: linkAsset || undefined,
      } });
      router.replace(`/home-intel/documents/${res.id}`);
    } catch (e: any) { Alert.alert("Upload failed", e?.message || "Try again."); }
    finally { setUploading(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Add Document" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        <Pressable testID="add-file" style={styles.fileBox} onPress={addPhoto}>
          {photo ? <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.file} contentFit="cover" /> :
            <><MaterialCommunityIcons name="scan-helper" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.hint}>Scan or upload a photo / PDF page</Text></>}
        </Pressable>

        <Text style={styles.label}>What is this document?</Text>
        <View style={styles.chips}>
          {CATS.map((c) => (
            <Pressable key={c} testID={`add-cat-${c}`} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}>
              <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c.replace(/_/g, " ")}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Title (optional)</Text>
        <TextInput testID="add-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Water Heater Manual" placeholderTextColor={colors.onSurfaceTertiary} />

        {assets.length > 0 && (
          <>
            <Text style={styles.label}>Link to an asset (optional)</Text>
            <View style={styles.chips}>
              <Pressable testID="add-link-none" style={[styles.chip, !linkAsset && styles.chipOn]} onPress={() => setLinkAsset(null)}>
                <Text style={[styles.chipText, !linkAsset && styles.chipTextOn]}>None</Text>
              </Pressable>
              {assets.map((a) => (
                <Pressable key={a.id} testID={`add-link-${a.id}`} style={[styles.chip, linkAsset === a.id && styles.chipOn]} onPress={() => setLinkAsset(a.id)}>
                  <Text style={[styles.chipText, linkAsset === a.id && styles.chipTextOn]}>{a.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Pressable testID="add-upload" style={[styles.btn, uploading && { opacity: 0.6 }]} disabled={uploading} onPress={upload}>
          {uploading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.btnText}>Upload & read document</Text>}
        </Pressable>
        <Text style={styles.note}>Homie reads details but never treats them as confirmed until you review them.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  fileBox: { height: 160, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, borderStyle: "dashed", backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  file: { width: "100%", height: "100%" },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  btn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  btnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", marginTop: spacing.sm },
});
