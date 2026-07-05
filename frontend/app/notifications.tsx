import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
  Modal, Switch,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Notif = { id: string; type: string; title: string; body: string; priority: string; read: boolean; created_at: string; meta?: any };
type Prefs = { project: boolean; safety: boolean; social: boolean; promo: boolean; system: boolean; dnd: boolean };

const META: Record<string, { icon: string; color: string }> = {
  project: { icon: "hammer-wrench", color: colors.brandPrimary },
  safety: { icon: "shield-alert", color: colors.error },
  social: { icon: "account-group", color: colors.info },
  promo: { icon: "tag", color: colors.warning },
  system: { icon: "bell", color: colors.onSurfaceSecondary },
};
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" }, { key: "project", label: "Projects" },
  { key: "safety", label: "Safety" }, { key: "social", label: "Social" }, { key: "promo", label: "News" },
];
const PREF_ROWS: { key: keyof Prefs; label: string; sub: string }[] = [
  { key: "project", label: "Projects & jobs", sub: "Proposals, invoices, status updates" },
  { key: "safety", label: "Safety & compliance", sub: "Always on for urgent alerts" },
  { key: "social", label: "Community & social", sub: "Neighbor offers, replies" },
  { key: "promo", label: "News & tips", sub: "Features and promotions" },
];

function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? "" : `?filter=${filter}`;
      const d = await api<{ items: Notif[]; unread_count: number }>(`/notifications${q}`);
      setItems(d.items); setUnread(d.unread_count);
    } catch {} finally { setLoading(false); }
  }, [filter]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openPrefs = async () => {
    try { setPrefs(await api<Prefs>("/notifications/preferences")); } catch {}
    setPrefsOpen(true);
  };
  const savePref = async (key: keyof Prefs, val: boolean) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: val };
    setPrefs(next);
    Haptics.selectionAsync();
    try { await api("/notifications/preferences", { method: "PUT", body: next }); } catch {}
  };

  const tap = async (n: Notif) => {
    if (!n.read) { try { await api(`/notifications/${n.id}/read`, { method: "POST" }); } catch {} }
    const jid = n.meta?.job_id, pid = n.meta?.post_id, eid = n.meta?.event_id;
    if (jid) router.push(`/jobs/${jid}`);
    else if (pid) router.push("/neighborhood");
    else if (eid) router.push("/emergency");
    else load();
    if (!jid && !pid && !eid) return;
  };
  const markAll = async () => { Haptics.selectionAsync(); try { await api("/notifications/read-all", { method: "POST" }); } catch {} load(); };
  const del = async (id: string) => { try { await api(`/notifications/${id}`, { method: "DELETE" }); } catch {} load(); };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="notif-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Notifications{unread > 0 ? ` (${unread})` : ""}</Text>
        <Pressable testID="notif-prefs" hitSlop={10} onPress={openPrefs}><MaterialCommunityIcons name="cog-outline" size={22} color={colors.onSurface} /></Pressable>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} testID={`notif-filter-${f.key}`} style={[styles.filter, filter === f.key && styles.filterOn]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {unread > 0 && (
        <Pressable testID="notif-mark-all" style={styles.markAll} onPress={markAll}><Text style={styles.markAllText}>Mark all as read</Text></Pressable>
      )}

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
          {items.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><MaterialCommunityIcons name="bell-check-outline" size={44} color={colors.brandPrimary} /></View>
              <Text style={styles.emptyTitle}>You're all caught up</Text>
              <Text style={styles.emptySub}>Project updates, safety alerts and neighbor activity will show up here.</Text>
            </View>
          ) : items.map((n) => {
            const m = META[n.type] || META.system;
            const urgent = n.priority === "urgent" && !n.read;
            return (
              <Pressable key={n.id} testID={`notif-${n.id}`} style={[styles.card, !n.read && styles.cardUnread, urgent && styles.cardUrgent]} onPress={() => tap(n)}>
                <View style={[styles.iconWrap, { backgroundColor: m.color + "22" }]}>
                  <MaterialCommunityIcons name={m.icon as any} size={20} color={m.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{n.title}</Text>
                    <Text style={styles.time}>{timeAgo(n.created_at)}</Text>
                  </View>
                  <Text style={styles.cardBody} numberOfLines={2}>{n.body}</Text>
                  {urgent && <View style={styles.urgentTag}><MaterialCommunityIcons name="alert" size={11} color="#fff" /><Text style={styles.urgentText}>ACTION REQUIRED</Text></View>}
                </View>
                <Pressable testID={`notif-del-${n.id}`} hitSlop={8} onPress={() => del(n.id)} style={styles.delBtn}><MaterialCommunityIcons name="close" size={16} color={colors.onSurfaceTertiary} /></Pressable>
                {!n.read && <View style={styles.dot} />}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={prefsOpen} transparent animationType="slide" onRequestClose={() => setPrefsOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>Notification settings</Text>
            {prefs && (
              <>
                {PREF_ROWS.map((r) => (
                  <View key={r.key} style={styles.prefRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.prefLabel}>{r.label}</Text>
                      <Text style={styles.prefSub}>{r.sub}</Text>
                    </View>
                    <Switch testID={`pref-${r.key}`} value={r.key === "safety" ? true : prefs[r.key]} disabled={r.key === "safety"}
                      onValueChange={(v) => savePref(r.key, v)} trackColor={{ true: colors.brandPrimary, false: colors.border }} />
                  </View>
                ))}
                <View style={[styles.prefRow, styles.dndRow]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prefLabel}>Do Not Disturb</Text>
                    <Text style={styles.prefSub}>Pause non-urgent alerts</Text>
                  </View>
                  <Switch testID="pref-dnd" value={prefs.dnd} onValueChange={(v) => savePref("dnd", v)} trackColor={{ true: colors.brandPrimary, false: colors.border }} />
                </View>
                <Text style={styles.channelNote}>Push & SMS delivery unlock after you publish a device build.</Text>
              </>
            )}
            <Pressable style={styles.doneBtn} onPress={() => setPrefsOpen(false)}><Text style={styles.doneText}>DONE</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: spacing["3xl"] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  filterRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  filter: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  filterOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  filterTextOn: { color: colors.onBrandPrimary },
  markAll: { alignSelf: "flex-end", paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  markAllText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing["3xl"] },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", maxWidth: 280, lineHeight: 20 },
  card: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardUnread: { borderColor: colors.borderStrong },
  cardUrgent: { borderColor: colors.error, backgroundColor: colors.error + "0D" },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  time: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  cardBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, lineHeight: 18 },
  urgentTag: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", backgroundColor: colors.error, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, marginTop: 6 },
  urgentText: { color: "#fff", fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  delBtn: { padding: 2 },
  dot: { position: "absolute", top: 10, right: 30, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.md },
  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  dndRow: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: spacing.sm, paddingTop: spacing.md },
  prefLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  prefSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  channelNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.md, fontStyle: "italic" },
  doneBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg },
  doneText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
});
