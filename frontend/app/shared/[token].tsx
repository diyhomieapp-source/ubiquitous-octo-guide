import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Image } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export default function SharedJob() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api(`/hi/shared/${token}`, { auth: false })); }
    catch (e: any) { setError(e?.message || "This link is not available."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  if (error) return (
    <View style={styles.center}>
      <MaterialCommunityIcons name="link-off" size={40} color={colors.onSurfaceTertiary} />
      <Text style={styles.errText}>{error}</Text>
    </View>
  );

  const r = data.report;
  const a = r.asset_details;
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], maxWidth: 760, width: "100%", alignSelf: "center" }}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="home-heart" size={22} color={colors.brandPrimary} />
        <Text style={styles.brand}>Shared by {data.shared_by}</Text>
      </View>
      <Text style={styles.expiry}>This report expires {(data.expires_at || "").slice(0, 10)}</Text>

      <Text style={styles.title}>{r.title}</Text>
      <Text style={styles.meta}>Area: {r.area} · Status: {r.current_status}</Text>

      {r.issue_description ? (<><Text style={styles.section}>Issue</Text><Text style={styles.body}>{r.issue_description}</Text></>) : null}

      {a ? (
        <>
          <Text style={styles.section}>Related equipment</Text>
          <Text style={styles.body}>{[a.name, a.category, a.brand, a.model].filter(Boolean).join(" · ") || "—"}</Text>
        </>
      ) : null}

      {(r.attempted_actions || []).length > 0 && (
        <>
          <Text style={styles.section}>Actions already attempted</Text>
          {r.attempted_actions.map((x: string, i: number) => <Text key={i} style={styles.li}>• {x}</Text>)}
        </>
      )}

      {(r.photos || []).length > 0 && (
        <>
          <Text style={styles.section}>Photos</Text>
          <View style={styles.photoWrap}>
            {r.photos.map((p: string, i: number) => (
              <Image key={i} source={{ uri: p.startsWith("http") || p.startsWith("data:") ? p : `data:image/jpeg;base64,${p}` }} style={styles.photo} />
            ))}
          </View>
        </>
      )}

      {(r.documents || []).length > 0 && (
        <>
          <Text style={styles.section}>Documents</Text>
          {r.documents.map((d: any, i: number) => (
            <View key={i} style={styles.docRow}><MaterialCommunityIcons name="file-document-outline" size={16} color={colors.brandPrimary} /><Text style={styles.body}>{d.title}</Text></View>
          ))}
        </>
      )}

      {r.safety_notes ? (<><Text style={styles.section}>Safety notes</Text><Text style={[styles.body, { color: colors.warning }]}>{r.safety_notes}</Text></>) : null}

      {data.contact && (
        <View style={styles.contactCard}>
          <Text style={styles.section}>How to reach the homeowner</Text>
          <Text style={styles.body}>Preferred: {data.contact.preferred_contact_method}{data.contact.contact_value ? ` · ${data.contact.contact_value}` : ""}</Text>
          {data.contact.availability_notes ? <Text style={styles.body}>Availability: {data.contact.availability_notes}</Text> : null}
        </View>
      )}

      <Text style={styles.disclaimer}>{r.disclaimer}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md, backgroundColor: colors.surface },
  errText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, textAlign: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xl },
  brand: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  expiry: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, marginBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type["2xl"] },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.xs },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  li: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22 },
  photoWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photo: { width: 110, height: 110, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  docRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  contactCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, fontStyle: "italic", marginTop: spacing.xl, lineHeight: 16 },
});
