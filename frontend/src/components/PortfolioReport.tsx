import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";

const money = (c: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;
const fmt = (iso?: string) => { try { return new Date(iso!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; } };

export type Portfolio = {
  owner: string; location?: string; generated_at?: string;
  totals: { projects: number; invested_cents: number; saved_cents: number; hours: number; systems: number; rooms: number };
  projects: any[]; systems: any[]; rooms: any[];
};

export function PortfolioReport({ d }: { d: Portfolio }) {
  const t = d.totals;
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={styles.head}>
        <View style={styles.badge}><MaterialCommunityIcons name="certificate-outline" size={24} color={colors.brandPrimary} /></View>
        <Text style={styles.h1}>Home Improvement Record</Text>
        <Text style={styles.owner}>{d.owner}{d.location ? ` · ${d.location}` : ""}</Text>
        <Text style={styles.stamp}>Generated {fmt(d.generated_at)} · DIYhomie verified</Text>
      </View>

      <View style={styles.statGrid}>
        <Stat label="PROJECTS" value={String(t.projects)} />
        <Stat label="INVESTED" value={money(t.invested_cents)} color={colors.info} />
        <Stat label="SAVED VS PRO" value={money(t.saved_cents)} color={colors.success} />
        <Stat label="HOURS" value={String(t.hours)} />
      </View>

      {d.projects.length > 0 && (
        <View>
          <Text style={styles.section}>COMPLETED WORK</Text>
          {d.projects.map((p, i) => (
            <View key={i} style={styles.card}>
              <Text style={styles.pTitle}>{p.story_title || p.title}</Text>
              <Text style={styles.pProject}>{p.title}{p.room ? ` · ${p.room}` : ""} · {fmt(p.created_at)}</Text>
              {(p.before_photo || p.after_photo) && (
                <View style={styles.photos}>
                  {p.before_photo && <Image source={{ uri: `data:image/jpeg;base64,${p.before_photo}` }} style={styles.photo} contentFit="cover" />}
                  {p.after_photo && <Image source={{ uri: `data:image/jpeg;base64,${p.after_photo}` }} style={styles.photo} contentFit="cover" />}
                </View>
              )}
              {!!p.story && <Text style={styles.pStory}>{p.story}</Text>}
              <View style={styles.pMeta}>
                {p.cost_cents > 0 && <Text style={styles.pill}>Cost {money(p.cost_cents)}</Text>}
                {p.money_saved_cents > 0 && <Text style={[styles.pill, { color: colors.success }]}>Saved {money(p.money_saved_cents)}</Text>}
                {p.hours > 0 && <Text style={styles.pill}>{p.hours} hrs (DIY)</Text>}
                {p.skill_tag && <Text style={[styles.pill, { color: colors.brandPrimary }]}>{p.skill_tag}</Text>}
              </View>
            </View>
          ))}
        </View>
      )}

      {d.systems.length > 0 && (
        <View>
          <Text style={styles.section}>SYSTEMS & WARRANTIES</Text>
          {d.systems.map((s, i) => (
            <View key={i} style={styles.sysRow}>
              <MaterialCommunityIcons name="water-boiler" size={18} color={colors.info} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sysName}>{s.name} <Text style={styles.sysType}>· {s.type}</Text></Text>
                <Text style={styles.sysMeta}>
                  {[s.brand, s.model, s.serial && `SN ${s.serial}`, s.install_year && `installed ${s.install_year}`, s.warranty_expires && `warranty to ${s.warranty_expires}`].filter(Boolean).join(" · ") || "No details on file"}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {d.rooms.length > 0 && (
        <View>
          <Text style={styles.section}>ROOMS</Text>
          <Text style={styles.roomsLine}>{d.rooms.map((r) => r.name).join(" · ")}</Text>
        </View>
      )}

      <Text style={styles.footer}>This record was compiled from the homeowner's DIYhomie project history. Costs and savings are self-reported. Useful for insurance claims, resale, and refinancing.</Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statNum, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: "center", gap: 4 },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, textAlign: "center" },
  owner: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  stamp: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: { width: "47%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  statNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  section: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  pTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  pProject: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  photos: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  photo: { flex: 1, height: 120, borderRadius: radius.sm },
  pStory: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginTop: 2 },
  pMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  pill: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, overflow: "hidden" },
  sysRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  sysName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  sysType: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  sysMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  roomsLine: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, lineHeight: 22 },
  footer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, fontStyle: "italic", lineHeight: 18, marginTop: spacing.md },
});
