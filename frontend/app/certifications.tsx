import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform, Linking } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Status = { level: string; label: string; active: number; total: number; pro_validated: number; is_verified: boolean; to_next: { next: string; need: number } | null };
type Cert = { id: string; title: string; room: string; skill: string; status: string; issued_at: string; money_saved_cents: number; hours: number; code_compliant: boolean; pro_validated: boolean; share_token: string | null; level_at_issue: string };
type Eligible = { project_id: string; title: string; room: string; at: string };

const LEVEL_ICON: Record<string, any> = { unverified: "shield-outline", verified: "shield-check", advanced: "shield-star", master: "shield-crown" };
const LEVEL_COLOR: Record<string, string> = { unverified: colors.onSurfaceTertiary, verified: colors.success, advanced: colors.brandPrimary, master: "#9B51E0" };

export default function Certifications() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status | null>(null);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([
        api<{ status: Status; certificates: Cert[] }>("/certifications"),
        api<{ eligible: Eligible[] }>("/certifications/eligible"),
      ]);
      setStatus(c.status); setCerts(c.certificates); setEligible(e.eligible);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generate = async (projectId: string) => {
    setBusy(projectId); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api("/certifications/generate", { method: "POST", body: { project_id: projectId } });
      Alert.alert("Certificate issued 🎉", "Your DIYhomie Verified certificate is ready to view and share.");
      load();
    } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(null); }
  };

  const openCert = async (cert: Cert) => {
    setBusy(cert.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const token = cert.share_token || (await api<{ token: string }>(`/certifications/${cert.id}/share`, { method: "POST" })).token;
      const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/certifications/verify/${token}`;
      await Clipboard.setStringAsync(url);
      if (Platform.OS === "web") { if (typeof window !== "undefined") window.open(url, "_blank"); }
      else { await Linking.openURL(url); }
      load();
    } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(null); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cert-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>DIYhomie Verified</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading || !status ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          {/* verified status hero */}
          <View style={[styles.hero, { borderColor: LEVEL_COLOR[status.level] }]}>
            <MaterialCommunityIcons name={LEVEL_ICON[status.level]} size={44} color={LEVEL_COLOR[status.level]} />
            <Text style={[styles.heroLabel, { color: LEVEL_COLOR[status.level] }]}>{status.label}</Text>
            <Text style={styles.heroSub}>{status.active} active certificate{status.active === 1 ? "" : "s"}{status.pro_validated ? ` · ${status.pro_validated} pro-validated` : ""}</Text>
            {status.to_next && status.to_next.need > 0 && (
              <Text style={styles.heroNext}>Complete {status.to_next.need} more to reach <Text style={{ fontFamily: font.bold, textTransform: "capitalize" }}>{status.to_next.next}</Text></Text>
            )}
          </View>

          {eligible.length > 0 && (
            <>
              <Text style={styles.section}>Ready to certify</Text>
              <Text style={styles.help}>You completed these projects — turn them into shareable, verifiable certificates.</Text>
              {eligible.map((e) => (
                <View key={e.project_id} style={styles.eligRow}>
                  <MaterialCommunityIcons name="trophy-outline" size={20} color={colors.brandPrimary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eligTitle} numberOfLines={1}>{e.title}</Text>
                    <Text style={styles.eligMeta}>{(e.room || "home").toUpperCase()} · {(e.at || "").slice(0, 10)}</Text>
                  </View>
                  <Pressable testID={`cert-generate-${e.project_id}`} style={styles.genBtn} onPress={() => generate(e.project_id)} disabled={busy === e.project_id}>
                    {busy === e.project_id ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Text style={styles.genText}>Certify</Text>}
                  </Pressable>
                </View>
              ))}
            </>
          )}

          <Text style={styles.section}>My certificates ({certs.length})</Text>
          {certs.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="certificate-outline" size={40} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Complete a project to earn your first DIYhomie Verified certificate.</Text>
            </View>
          ) : certs.map((c) => {
            const revoked = c.status === "revoked";
            return (
              <View key={c.id} testID="cert-card" style={[styles.card, revoked && { opacity: 0.6, borderColor: colors.error }]}>
                <View style={styles.cardTop}>
                  <MaterialCommunityIcons name={c.pro_validated ? "shield-star" : "certificate"} size={22} color={revoked ? colors.error : colors.brandPrimary} />
                  <Text style={styles.cardTitle} numberOfLines={2}>{c.title}</Text>
                </View>
                <View style={styles.badgeRow}>
                  <Badge label={(c.room || "home").toUpperCase()} />
                  {c.code_compliant && <Badge label="Code Compliant" tone="success" />}
                  {c.pro_validated && <Badge label="Pro-Validated" tone="brand" />}
                  {revoked && <Badge label="Revoked" tone="error" />}
                </View>
                <Text style={styles.cardMeta}>
                  {c.skill || "DIY"} · {c.hours ? `${c.hours}h · ` : ""}{c.money_saved_cents ? `Saved $${Math.round(c.money_saved_cents / 100)} · ` : ""}Issued {(c.issued_at || "").slice(0, 10)}
                </Text>
                {!revoked && (
                  <Pressable testID={`cert-open-${c.id}`} style={styles.openBtn} onPress={() => openCert(c)} disabled={busy === c.id}>
                    {busy === c.id ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><MaterialCommunityIcons name="open-in-new" size={16} color={colors.onBrandPrimary} /><Text style={styles.openText}>View & share certificate</Text></>}
                  </Pressable>
                )}
              </View>
            );
          })}

          <Text style={styles.footNote}>Certificates are verifiable by lenders, insurers &amp; buyers via a secure DIYhomie link. Only you control when they&apos;re shared.</Text>
        </ScrollView>
      )}
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone?: "success" | "brand" | "error" }) {
  const c = tone === "success" ? colors.success : tone === "error" ? colors.error : tone === "brand" ? colors.brandPrimary : colors.onSurfaceTertiary;
  return <View style={[styles.badge, { borderColor: c + "66", backgroundColor: c + "18" }]}><Text style={[styles.badgeText, { color: c }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  hero: { alignItems: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderRadius: radius.lg, padding: spacing.xl, gap: 6 },
  heroLabel: { fontFamily: font.display, fontSize: 20, marginTop: spacing.xs, textAlign: "center" },
  heroSub: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  heroNext: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.xs },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginBottom: spacing.sm },
  eligRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  eligTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  eligMeta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 2 },
  genBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minWidth: 72, alignItems: "center" },
  genText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", paddingHorizontal: spacing.xl },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontFamily: font.bold, fontSize: 10 },
  cardMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.sm },
  openBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.sm, marginTop: spacing.md },
  openText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  footNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 17, marginTop: spacing.xl, textAlign: "center" },
});
