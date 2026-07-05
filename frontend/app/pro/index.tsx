import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${(Math.round((c || 0) / 100)).toLocaleString()}`;

type Me = {
  has_account: boolean;
  profile?: { name: string; status: string; trades: string[]; charges_enabled: boolean; payouts_enabled: boolean; rating: number; trusted: boolean };
  stats?: { active_jobs: number; completed_jobs: number; revenue_cents: number; outstanding_cents: number; rating: number; reviews_count: number };
};
type Job = { id: string; title: string; status: string; client_email: string; proposal?: { total_cents: number } | null; updated_at: string };

const STATUS_COLOR: Record<string, string> = {
  draft: colors.onSurfaceTertiary, proposal_sent: colors.info, approved: colors.brandPrimary,
  in_progress: colors.warning, completed: colors.success, cancelled: colors.error,
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", proposal_sent: "Proposal sent", approved: "Approved",
  in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
};

export default function ProDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<Me | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("/pro/me");
      setMe(m);
      if (m.has_account && m.profile?.status === "verified") setJobs(await api<Job[]>("/pro/jobs"));
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createJob = async () => {
    if (!email.trim() || !title.trim() || saving) return;
    setSaving(true);
    Haptics.selectionAsync();
    try {
      await api("/pro/jobs", { method: "POST", body: { client_email: email.trim(), title: title.trim(), description: desc.trim() } });
      setEmail(""); setTitle(""); setDesc(""); setOpen(false);
      load();
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="pro-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
      <Text style={styles.headerTitle}>Pro Dashboard</Text>
      <View style={{ width: 28 }} />
    </View>
  );

  // no account or not verified
  if (!me?.has_account) {
    return (
      <View style={styles.root}>{header}
        <View style={styles.gate}>
          <MaterialCommunityIcons name="hammer-wrench" size={44} color={colors.brandPrimary} />
          <Text style={styles.gateTitle}>Grow your business on DIYhomie</Text>
          <Text style={styles.gateSub}>Manage client jobs, send proposals & invoices, get paid, and earn a Trusted Pro badge.</Text>
          <Pressable testID="pro-apply-cta" style={styles.primaryBtn} onPress={() => router.push("/pro/apply")}>
            <Text style={styles.primaryText}>BECOME A PRO</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (me.profile?.status !== "verified") {
    const banned = me.profile?.status === "banned";
    return (
      <View style={styles.root}>{header}
        <View style={styles.gate}>
          <MaterialCommunityIcons name={banned ? "account-cancel" : "clock-outline"} size={44} color={banned ? colors.error : colors.warning} />
          <Text style={styles.gateTitle}>{banned ? "Account suspended" : "Verification pending"}</Text>
          <Text style={styles.gateSub}>{banned ? "Please contact support@diyhomie.com." : "Our team is reviewing your license & insurance. You'll get access to your dashboard once verified."}</Text>
          {!banned && (
            <Pressable testID="pro-credentials-banner" style={styles.primaryBtn} onPress={() => router.push("/pro/credentials")}>
              <Text style={styles.primaryText}>SUBMIT LICENSES & CREDENTIALS</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  const s = me.stats!;
  return (
    <View style={styles.root}>{header}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingHorizontal: spacing.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
        <View style={styles.nameRow}>
          <Text style={styles.proName}>{me.profile?.name}</Text>
          {me.profile?.trusted && <View style={styles.trust}><MaterialCommunityIcons name="shield-check" size={12} color={colors.onBrandPrimary} /><Text style={styles.trustText}>Trusted Pro</Text></View>}
        </View>

        <View style={styles.grid}>
          <Stat value={money(s.revenue_cents)} label="PAID REVENUE" color={colors.success} />
          <Stat value={money(s.outstanding_cents)} label="OUTSTANDING" color={colors.warning} />
          <Stat value={String(s.active_jobs)} label="ACTIVE JOBS" />
          <Stat value={`⭐ ${s.rating.toFixed(1)}`} label={`${s.reviews_count} REVIEWS`} />
        </View>

        {!me.profile?.charges_enabled && (
          <Pressable testID="pro-payout-banner" style={styles.payoutBanner} onPress={() => router.push("/pro/payouts")}>
            <MaterialCommunityIcons name="bank-outline" size={22} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.payoutTitle}>Set up payouts to get paid</Text>
              <Text style={styles.payoutSub}>Connect your bank via Stripe to accept invoice payments.</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
          </Pressable>
        )}

        <Pressable testID="pro-credentials-banner" style={styles.payoutBanner} onPress={() => router.push("/pro/credentials")}>
          <MaterialCommunityIcons name="certificate-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.payoutTitle}>Licenses & credentials</Text>
            <Text style={styles.payoutSub}>Verify your license & insurance to earn the Verified Pro badge.</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Text style={styles.section}>Client jobs</Text>
        {jobs.length === 0 ? (
          <View style={styles.empty}><MaterialCommunityIcons name="clipboard-text-outline" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No jobs yet. Tap + to start one for a client.</Text></View>
        ) : jobs.map((j) => (
          <Pressable key={j.id} testID={`pro-job-${j.id}`} style={styles.jobCard} onPress={() => router.push(`/jobs/${j.id}`)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.jobTitle} numberOfLines={1}>{j.title}</Text>
              <Text style={styles.jobMeta}>{j.client_email}{j.proposal ? ` · ${money(j.proposal.total_cents)}` : ""}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: (STATUS_COLOR[j.status] || colors.onSurfaceTertiary) + "22" }]}>
              <Text style={[styles.statusText, { color: STATUS_COLOR[j.status] || colors.onSurfaceTertiary }]}>{STATUS_LABEL[j.status] || j.status}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable testID="pro-new-job" style={[styles.fab, { bottom: insets.bottom + spacing.lg }]} onPress={() => { Haptics.selectionAsync(); setOpen(true); }}>
        <MaterialCommunityIcons name="plus" size={22} color={colors.onBrandPrimary} /><Text style={styles.fabText}>New job</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>New client job</Text>
            <TextInput testID="pro-job-email" style={styles.input} value={email} onChangeText={setEmail} placeholder="Client email" placeholderTextColor={colors.onSurfaceTertiary} autoCapitalize="none" keyboardType="email-address" />
            <TextInput testID="pro-job-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="Job title (e.g. Cedar deck build)" placeholderTextColor={colors.onSurfaceTertiary} />
            <TextInput testID="pro-job-desc" style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={desc} onChangeText={setDesc} placeholder="Scope / notes (optional)" placeholderTextColor={colors.onSurfaceTertiary} multiline />
            <View style={styles.sheetBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="pro-job-create" style={[styles.saveBtn, (!email.trim() || !title.trim() || saving) && { opacity: 0.5 }]} onPress={createJob} disabled={!email.trim() || !title.trim() || saving}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>CREATE JOB</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return <View style={styles.stat}><Text style={[styles.statValue, color && { color }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  gate: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  gateTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, textAlign: "center" },
  gateSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, textAlign: "center", lineHeight: 24, maxWidth: 320 },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.md },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  proName: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  trust: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  trustText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { width: "47%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5, marginTop: 2 },
  payoutBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  payoutTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  payoutSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", maxWidth: 260 },
  jobCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  jobTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  jobMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontFamily: font.bold, fontSize: 10 },
  fab: { position: "absolute", right: spacing.lg, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, shadowColor: colors.brandPrimary, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 },
  fabText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.md },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.md },
  sheetBtns: { flexDirection: "row", gap: spacing.sm },
  cancelBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  saveBtn: { flex: 2, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
});
