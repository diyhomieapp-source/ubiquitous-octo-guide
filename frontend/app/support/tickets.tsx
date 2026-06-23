import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { api } from "@/src/api";

type Ticket = { id: string; category: string; subject: string; message: string; status: string; created_at: string };

const STATUS_COLOR: Record<string, string> = {
  open: colors.info, in_progress: colors.warning, resolved: colors.success, closed: colors.onSurfaceTertiary,
};
const fmtDate = (iso?: string) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
};

export default function TicketsScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<Ticket[]>("/support/tickets");
      setTickets(res);
    } catch { /* keep */ } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="My Support"
        right={
          <Pressable testID="tickets-new" onPress={() => router.push("/support/ticket")} hitSlop={10}>
            <MaterialCommunityIcons name="plus-circle" size={26} color={colors.brandPrimary} />
          </Pressable>
        }
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {tickets.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="lifebuoy" size={56} color={colors.surfaceTertiary} />
              <Text style={styles.emptyTitle}>No tickets yet</Text>
              <Text style={styles.emptySub}>Need a hand? Open a ticket and our team will help.</Text>
              <Pressable testID="tickets-empty-new" style={styles.cta} onPress={() => router.push("/support/ticket")}>
                <Text style={styles.ctaText}>NEW TICKET</Text>
              </Pressable>
            </View>
          ) : (
            tickets.map((t) => (
              <View key={t.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.cat}>{t.category}</Text>
                  <View style={[styles.statusPill, { backgroundColor: (STATUS_COLOR[t.status] || colors.info) + "22" }]}>
                    <View style={[styles.dot, { backgroundColor: STATUS_COLOR[t.status] || colors.info }]} />
                    <Text style={[styles.statusText, { color: STATUS_COLOR[t.status] || colors.info }]}>
                      {t.status.replace("_", " ").toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={styles.subject} numberOfLines={1}>{t.subject}</Text>
                <Text style={styles.msg} numberOfLines={2}>{t.message}</Text>
                <View style={styles.cardFoot}>
                  <Text style={styles.ref}>#{t.id.slice(0, 8).toUpperCase()}</Text>
                  <Text style={styles.date}>{fmtDate(t.created_at)}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md, flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingTop: spacing["3xl"] },
  emptyTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl, marginTop: spacing.md },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", paddingHorizontal: spacing.xl },
  cta: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.lg },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 1 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  cat: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  subject: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  msg: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, lineHeight: 18 },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  ref: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  date: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
});
