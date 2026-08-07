import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

type Doc = { id: string; document_type: string; processing_status: string; has_text?: boolean; excerpt?: string; uploaded_at: string };
type Hist = { issue_id: string; description: string; status: string; risk_level: string; outcome?: string; created_at: string };
type Asset = { id: string; name: string; category: string; brand?: string; model_number?: string; installation_date?: string; photo_base64?: string; room_name?: string; status?: string };

const DOC_TYPES = ["manual", "receipt", "warranty", "other"];
const STATUS_COLOR: Record<string, string> = { active: colors.info, completed: colors.success, unresolved: colors.warning, escalated: colors.error };

export default function AssetDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [history, setHistory] = useState<Hist[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ asset: Asset; documents: Doc[]; history: Hist[] }>(`/hi/assets/${id}`);
      setAsset(d.asset); setDocs(d.documents); setHistory(d.history);
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const uploadDoc = (docType: string) => {
    Alert.alert("Add " + docType, "Snap or choose a photo of the " + docType, [
      { text: "Camera", onPress: () => doUpload(docType, "camera") },
      { text: "Library", onPress: () => doUpload(docType, "library") },
      { text: "Cancel", style: "cancel" },
    ]);
  };
  const doUpload = async (docType: string, src: "camera" | "library") => {
    const b64 = src === "camera" ? await takePhoto("Snap the document.") : await pickFromLibrary("Choose the document photo.");
    if (!b64) return;
    setUploading(true);
    try {
      await api(`/hi/assets/${id}/documents`, { method: "POST", body: { document_type: docType, file_base64: b64 } });
      await load();
      Alert.alert("Added", "We read the document — future guidance will use it.");
    } catch (e: any) { Alert.alert("Upload failed", e?.message || "Try again."); }
    finally { setUploading(false); }
  };

  const addDocument = () => {
    Alert.alert("Document type", "What are you adding?", [
      ...DOC_TYPES.map((t) => ({ text: t.charAt(0).toUpperCase() + t.slice(1), onPress: () => uploadDoc(t) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  if (loading || !asset) return <View style={styles.root}><ScreenHeader title="Asset" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title={asset.name} right={
        <Pressable testID="hi-edit-asset" onPress={() => router.push(`/home-intel/asset-add?id=${id}`)}>
          <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.brandPrimary} />
        </Pressable>} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {asset.photo_base64 && <Image source={{ uri: `data:image/jpeg;base64,${asset.photo_base64}` }} style={styles.hero} contentFit="cover" />}
        <View style={styles.infoCard}>
          <Row k="Category" v={asset.category} />
          <Row k="Room" v={asset.room_name || "Unassigned"} />
          {!!asset.brand && <Row k="Brand" v={asset.brand} />}
          {!!asset.model_number && <Row k="Model" v={asset.model_number} />}
          {!!asset.installation_date && <Row k="Installed" v={asset.installation_date} />}
        </View>

        <Pressable testID="hi-get-help" style={styles.helpBtn} onPress={() => router.push(`/home-intel/help?assetId=${id}`)}>
          <MaterialCommunityIcons name="lifebuoy" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.helpText}>Get Help with this asset</Text>
        </Pressable>

        <View style={styles.sectionRow}>
          <Text style={styles.section}>Documents</Text>
          <Pressable testID="hi-add-doc" style={styles.smallBtn} onPress={addDocument} disabled={uploading}>
            {uploading ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.smallBtnText}>+ Add</Text>}
          </Pressable>
        </View>
        {docs.length === 0 ? <Text style={styles.empty}>No documents yet. Add a manual, receipt or warranty photo so guidance is grounded in your exact equipment.</Text> :
          docs.map((d) => (
            <View key={d.id} style={styles.docRow}>
              <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.docType}>{d.document_type}</Text>
                {!!d.excerpt && <Text style={styles.docExcerpt} numberOfLines={2}>{d.excerpt}</Text>}
              </View>
              <Text style={[styles.docStatus, d.processing_status === "failed" && { color: colors.error }]}>{d.processing_status === "done" ? "read ✓" : d.processing_status}</Text>
            </View>
          ))}

        <Text style={styles.section}>Maintenance history</Text>
        {history.length === 0 ? <Text style={styles.empty}>No history yet.</Text> :
          history.map((h) => (
            <Pressable key={h.issue_id} testID={`hi-hist-${h.issue_id}`} style={styles.histRow} onPress={() => router.push(`/home-intel/guidance?issueId=${h.issue_id}`)}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[h.status] || colors.info }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.histText} numberOfLines={1}>{h.description}</Text>
                <Text style={styles.histMeta}>{h.outcome || h.status}{h.risk_level === "emergency" ? " · ⚠ emergency" : ""} · {(h.created_at || "").slice(0, 10)}</Text>
              </View>
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.kv}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { width: "100%", height: 180, borderRadius: radius.md, marginBottom: spacing.md, backgroundColor: colors.surfaceTertiary },
  infoCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomColor: colors.border, borderBottomWidth: 1 },
  k: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  v: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  helpBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  helpText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginTop: spacing.sm },
  smallBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 5, minWidth: 56, alignItems: "center" },
  smallBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  docRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.sm },
  docType: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  docExcerpt: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  docStatus: { color: colors.success, fontFamily: font.medium, fontSize: type.sm },
  histRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  histText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  histMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
});
