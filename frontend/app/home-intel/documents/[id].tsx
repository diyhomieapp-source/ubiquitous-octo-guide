import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Ext = { id: string; field_name: string; extracted_value: string; confidence_level: string; status: string; source_excerpt?: string };
type Rel = { related_entity_type: string; relationship_type: string; name?: string };
const CONF_COLOR: Record<string, string> = { "Confirmed by User": colors.success, "Likely": colors.info, "Needs Review": colors.warning };

export default function DocumentDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doc, setDoc] = useState<any>(null);
  const [exts, setExts] = useState<Ext[]>([]);
  const [rels, setRels] = useState<Rel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [ask, setAsk] = useState(false); const [q, setQ] = useState(""); const [answer, setAnswer] = useState<string | null>(null); const [asking, setAsking] = useState(false);
  const [assets, setAssets] = useState<{ id: string; name: string }[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ document: any; extractions: Ext[]; relationships: Rel[] }>(`/hi/documents/${id}`);
      setDoc(d.document); setExts(d.extractions); setRels(d.relationships);
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const review = async (ext: Ext, status: string, value?: string) => {
    try { await api(`/hi/documents/${id}/extractions/${ext.id}`, { method: "PUT", body: { status, extracted_value: value } }); setEditId(null); load(); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
  };
  const del = async () => {
    Alert.alert("Delete document?", "This won't delete any linked asset or project.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/hi/documents/${id}`, { method: "DELETE" }); router.back(); } catch {} } },
    ]);
  };
  const openLink = async () => {
    try { const d = await api<{ assets: { id: string; name: string }[] }>("/hi/assets"); setAssets(d.assets); setLinkOpen(true); } catch {}
  };
  const linkAsset = async (aid: string) => {
    try { await api(`/hi/documents/${id}/link`, { method: "POST", body: { related_entity_type: "asset", related_entity_id: aid, relationship_type: "manual_for" } }); setLinkOpen(false); load(); }
    catch (e: any) { Alert.alert("Couldn't link", e?.message || "Try again."); }
  };
  const doAsk = async () => {
    if (!q.trim()) return; setAsking(true); setAnswer(null);
    try { const r = await api<{ answer: string }>(`/hi/documents/${id}/ask`, { method: "POST", body: { question: q.trim() } }); setAnswer(r.answer); }
    catch { setAnswer("Couldn't answer right now."); } finally { setAsking(false); }
  };

  if (loading || !doc) return <View style={styles.root}><ScreenHeader title="Document" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title={doc.title} right={<Pressable testID="doc-delete" onPress={del}><MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} /></Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {doc.file_type === "image" && doc.file_base64 && <Image source={{ uri: `data:image/jpeg;base64,${doc.file_base64}` }} style={styles.preview} contentFit="contain" />}
        <Text style={styles.cat}>{doc.category.replace(/_/g, " ")} · {(doc.created_at || "").slice(0, 10)}</Text>

        <View style={styles.actions}>
          <Act testID="doc-ask" icon="robot-happy-outline" label="Ask Homie" onPress={() => { setAsk(true); setAnswer(null); setQ(""); }} />
          <Act testID="doc-link" icon="link-variant" label="Link to Asset" onPress={openLink} />
        </View>

        <Text style={styles.section}>Extracted details</Text>
        {exts.length === 0 ? <Text style={styles.empty}>No auto-extracted details. You can still link and search this document.</Text> :
          exts.map((e) => (
            <View key={e.id} style={styles.extCard}>
              <View style={styles.extTop}>
                <Text style={styles.extField}>{e.field_name.replace(/_/g, " ")}</Text>
                <View style={[styles.badge, { borderColor: CONF_COLOR[e.confidence_level] || colors.warning }]}><Text style={[styles.badgeText, { color: CONF_COLOR[e.confidence_level] || colors.warning }]}>{e.confidence_level}</Text></View>
              </View>
              {editId === e.id ? (
                <>
                  <TextInput testID={`doc-ext-edit-${e.id}`} style={styles.input} value={editVal} onChangeText={setEditVal} />
                  <View style={styles.extBtns}>
                    <Pressable testID={`doc-ext-savecfg-${e.id}`} style={styles.miniPrimary} onPress={() => review(e, "confirmed", editVal)}><Text style={styles.miniPrimaryText}>Save & confirm</Text></Pressable>
                    <Pressable style={styles.mini} onPress={() => setEditId(null)}><Text style={styles.miniText}>Cancel</Text></Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.extVal}>{e.extracted_value}</Text>
                  {e.status === "pending_review" ? (
                    <View style={styles.extBtns}>
                      <Pressable testID={`doc-ext-confirm-${e.id}`} style={styles.miniPrimary} onPress={() => review(e, "confirmed")}><Text style={styles.miniPrimaryText}>Confirm</Text></Pressable>
                      <Pressable testID={`doc-ext-edit-btn-${e.id}`} style={styles.mini} onPress={() => { setEditId(e.id); setEditVal(e.extracted_value); }}><Text style={styles.miniText}>Edit</Text></Pressable>
                      <Pressable testID={`doc-ext-reject-${e.id}`} style={styles.mini} onPress={() => review(e, "rejected")}><Text style={styles.miniText}>Reject</Text></Pressable>
                    </View>
                  ) : <Text style={styles.reviewed}>{e.status === "confirmed" ? "✓ confirmed by you" : "rejected"}</Text>}
                </>
              )}
            </View>
          ))}

        <Text style={styles.section}>Linked to</Text>
        {rels.length === 0 ? <Text style={styles.empty}>Not linked yet.</Text> :
          rels.map((rel, i) => <View key={i} style={styles.relRow}><MaterialCommunityIcons name="link-variant" size={16} color={colors.brandPrimary} /><Text style={styles.relText}>{rel.name || rel.related_entity_type} · {rel.relationship_type.replace(/_/g, " ")}</Text></View>)}
      </ScrollView>

      <Modal visible={ask} transparent animationType="slide" onRequestClose={() => setAsk(false)}>
        <View style={styles.modalBg}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Ask about this document</Text>
          <TextInput testID="doc-ask-input" style={styles.modalInput} value={q} onChangeText={setQ} placeholder="e.g. What's the warranty period?" placeholderTextColor={colors.onSurfaceTertiary} multiline />
          {answer && <Text style={styles.answer}>{answer}</Text>}
          <Pressable testID="doc-ask-send" style={styles.miniPrimary} disabled={asking} onPress={doAsk}>{asking ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.miniPrimaryText}>Ask</Text>}</Pressable>
          <Pressable style={styles.modalClose} onPress={() => setAsk(false)}><Text style={styles.miniText}>Close</Text></Pressable>
        </View></View>
      </Modal>

      <Modal visible={linkOpen} transparent animationType="slide" onRequestClose={() => setLinkOpen(false)}>
        <View style={styles.modalBg}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Link to an asset</Text>
          <ScrollView style={{ maxHeight: 300 }}>
            {assets.length === 0 ? <Text style={styles.empty}>No assets yet.</Text> :
              assets.map((a) => <Pressable key={a.id} testID={`doc-linkto-${a.id}`} style={styles.linkRow} onPress={() => linkAsset(a.id)}><Text style={styles.relText}>{a.name}</Text><MaterialCommunityIcons name="chevron-right" size={18} color={colors.onSurfaceTertiary} /></Pressable>)}
          </ScrollView>
          <Pressable style={styles.modalClose} onPress={() => setLinkOpen(false)}><Text style={styles.miniText}>Close</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

function Act({ icon, label, onPress, testID }: any) {
  return <Pressable testID={testID} style={styles.act} onPress={onPress}><MaterialCommunityIcons name={icon} size={20} color={colors.brandPrimary} /><Text style={styles.actText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  preview: { width: "100%", height: 220, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  cat: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm, textTransform: "capitalize" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  act: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  actText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  extCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  extTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  extField: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontFamily: font.bold, fontSize: 10 },
  extVal: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.xs },
  extBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  miniPrimary: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8, alignItems: "center" },
  miniPrimaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  mini: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 8 },
  miniText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  reviewed: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.xs },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.xs },
  relRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  relText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, textTransform: "capitalize" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  modalInput: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 70, textAlignVertical: "top" },
  answer: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.md },
  linkRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  modalClose: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm },
});
