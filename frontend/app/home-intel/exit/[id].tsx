import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary } from "@/src/utils/pickImage";

const CONDITIONS = ["New", "Like New", "Good", "Fair", "Poor", "Nonworking", "Unknown"];
const WORKING = [["working", "Works"], ["partially_working", "Partly"], ["not_working", "Doesn't work"], ["unknown", "Not sure"]];
const EXIT_ICON: Record<string, string> = {
  keep: "archive-outline", repair: "wrench-outline", private_sale: "cash", managed_marketplace: "storefront-outline",
  instant_buyback: "flash-outline", trade_in: "swap-horizontal", donation: "hand-heart-outline",
  recycle: "recycle", dispose: "trash-can-outline",
};
const EXIT_LABEL: Record<string, string> = {
  keep: "Keep", repair: "Repair", private_sale: "Private sale", managed_marketplace: "Marketplace",
  instant_buyback: "Instant buyback", trade_in: "Trade in", donation: "Donate", recycle: "Recycle", dispose: "Dispose",
};
const HL = [["best_overall", "Best overall", "star"], ["highest_return", "Highest return", "cash-multiple"],
  ["fastest", "Fastest", "clock-fast"], ["lowest_effort", "Lowest effort", "gesture-tap"],
  ["most_sustainable", "Most sustainable", "leaf"]];

export default function ExitCase() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [compare, setCompare] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // assessment form
  const [cond, setCond] = useState("Good");
  const [working, setWorking] = useState("working");
  const [damage, setDamage] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  // complete modal
  const [completeFor, setCompleteFor] = useState<string | null>(null);
  const [realized, setRealized] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api(`/hi/exit/cases/${id}`);
      setData(d);
      if ((d.options || []).length) {
        try { setCompare(await api(`/hi/exit/cases/${id}/compare`)); } catch {}
      }
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submitAssess = async () => {
    setBusy(true);
    try {
      await api(`/hi/exit/cases/${id}/assess`, { method: "POST", body: {
        user_reported_condition: cond, working_status: working, visible_damage_notes: damage.trim() || null, image_base64: photo,
      }});
      await load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const genOptions = async () => {
    setBusy(true);
    try { await api(`/hi/exit/cases/${id}/options`, { method: "POST" }); setCompare(await api(`/hi/exit/cases/${id}/compare`)); await load(); }
    catch (e: any) { Alert.alert("Couldn't compare", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const choose = async (opt: any, matchId?: string) => {
    setBusy(true);
    try {
      const res = await api(`/hi/exit/cases/${id}/select`, { method: "POST", body: { exit_option_id: opt.id, partner_match_id: matchId } });
      if (res.safety_guidance) Alert.alert("Stay safe in a private sale", res.safety_guidance.slice(0, 3).map((x: string) => "• " + x).join("\n\n"));
      await load();
    } catch (e: any) { Alert.alert("Couldn't select", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const makeListing = async () => {
    setBusy(true);
    try { await api(`/hi/exit/cases/${id}/listing`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't prepare listing", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const reviewListing = async () => {
    setBusy(true);
    try { await api(`/hi/exit/cases/${id}/listing`, { method: "PUT", body: { mark_reviewed: true } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const doComplete = async () => {
    if (!completeFor) return;
    setBusy(true);
    try {
      await api(`/hi/exit/cases/${id}/complete`, { method: "POST", body: {
        selected_exit_type: completeFor, realized_value: realized ? parseFloat(realized) : null, completion_status: "completed",
      }});
      setCompleteFor(null); setRealized("");
      await load();
    } catch (e: any) { Alert.alert("Couldn't complete", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Item" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const c = data.case; const assess = data.assessment; const options = data.options || [];
  const outcome = data.outcome; const listing = data.listing;
  const selType = c.selected_exit_type;

  return (
    <View style={styles.root}>
      <ScreenHeader title={c.title} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.itemMeta}>{c.category}</Text>

        {outcome && outcome.completion_status === "completed" ? (
          <View style={styles.doneCard}>
            <MaterialCommunityIcons name="check-circle" size={22} color="#27AE60" />
            <View style={{ flex: 1 }}>
              <Text style={styles.doneTitle}>Handled · {EXIT_LABEL[outcome.selected_exit_type]}</Text>
              {outcome.realized_value != null ? <Text style={styles.doneSub}>You got ${outcome.realized_value}</Text> : null}
              <Text style={styles.doneSub}>Item history is preserved in your home records.</Text>
            </View>
          </View>
        ) : null}

        {/* STEP 1 — condition */}
        {!assess && !outcome ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>How's its condition?</Text>
            <Text style={styles.label}>Condition (your view)</Text>
            <View style={styles.chipRow}>
              {CONDITIONS.map((x) => <Pressable key={x} testID={`cond-${x}`} style={[styles.chip, cond === x && styles.chipOn]} onPress={() => setCond(x)}><Text style={[styles.chipText, cond === x && styles.chipTextOn]}>{x}</Text></Pressable>)}
            </View>
            <Text style={styles.label}>Does it work?</Text>
            <View style={styles.chipRow}>
              {WORKING.map(([v, l]) => <Pressable key={v} testID={`work-${v}`} style={[styles.chip, working === v && styles.chipOn]} onPress={() => setWorking(v)}><Text style={[styles.chipText, working === v && styles.chipTextOn]}>{l}</Text></Pressable>)}
            </View>
            <Text style={styles.label}>Visible damage (optional)</Text>
            <TextInput testID="exit-damage" value={damage} onChangeText={setDamage} placeholder="e.g. small crack on corner" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Pressable testID="exit-photo" style={styles.photoBtn} onPress={async () => { const b = await pickFromLibrary("Add a photo so Homie can note visible condition."); if (b) setPhoto(b); }}>
              <MaterialCommunityIcons name={photo ? "check" : "camera-outline"} size={16} color={colors.brandPrimary} />
              <Text style={styles.photoText}>{photo ? "Photo added — Homie will note visible wear" : "Add a photo (optional)"}</Text>
            </Pressable>
            <Pressable testID="exit-assess-submit" disabled={busy} style={styles.primaryBtn} onPress={submitAssess}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Next</Text>}
            </Pressable>
          </View>
        ) : null}

        {/* condition summary */}
        {assess ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Condition</Text>
            <Row k="You reported" v={`${assess.user_reported_condition} · ${(assess.working_status || "").replace(/_/g, " ")}`} />
            {assess.ai_observed_condition ? <Row k="Homie saw (photo)" v={assess.ai_observed_condition} /> : null}
            {assess.visible_damage_notes ? <Row k="Damage notes" v={assess.visible_damage_notes} /> : null}
            <Text style={styles.tinyNote}>Homie can note visible wear from a photo but can't confirm it works, is genuine, or is safe — that's on you to check.</Text>
            {options.length === 0 && !outcome ? (
              <Pressable testID="exit-compare-btn" disabled={busy} style={styles.primaryBtn} onPress={genOptions}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Compare my options</Text>}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* highlights */}
        {compare && options.length ? (
          <>
            <Text style={styles.section}>Homie's picks</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
              {HL.map(([key, label, icon]) => {
                const h = compare.highlights[key]; if (!h) return null;
                return (
                  <View key={key} style={styles.hlCard}>
                    <MaterialCommunityIcons name={icon as any} size={18} color={colors.brandPrimary} />
                    <Text style={styles.hlLabel}>{label}</Text>
                    <Text style={styles.hlType}>{EXIT_LABEL[h.exit_type]}</Text>
                    {h.estimated_value_low != null ? <Text style={styles.hlVal}>${h.estimated_value_low}–${h.estimated_value_high}</Text> : <Text style={styles.hlVal}>—</Text>}
                  </View>
                );
              })}
            </ScrollView>

            <Text style={styles.section}>All options</Text>
            {options.map((o: any) => (
              <View key={o.id} testID={`opt-${o.exit_type}`} style={[styles.optCard, selType === o.exit_type && styles.optCardOn]}>
                <View style={styles.optHead}>
                  <MaterialCommunityIcons name={(EXIT_ICON[o.exit_type] || "circle-outline") as any} size={20} color={colors.brandPrimary} />
                  <Text style={styles.optTitle}>{EXIT_LABEL[o.exit_type]}</Text>
                  <Text style={styles.optVal}>{o.estimated_value_low != null ? `$${o.estimated_value_low}–${o.estimated_value_high}` : "—"}</Text>
                </View>
                <Text style={styles.optMeta}>Effort {o.effort_level} · {o.estimated_time_to_complete}{o.fees_estimate ? ` · ~$${o.fees_estimate} fees` : ""} · fit {o.suitability_score}%</Text>
                <Text style={styles.optWhy}>{o.explanation}</Text>
                {(o.partner_matches || []).map((m: any) => (
                  <View key={m.id} style={styles.partnerRow}>
                    <MaterialCommunityIcons name="open-in-new" size={13} color={colors.onSurfaceTertiary} />
                    <Text style={styles.partnerText}>{m.partner_name}{m.disclosure_required ? " · sponsored" : ""}</Text>
                  </View>
                ))}
                {o.status === "needs_verification" ? <Text style={styles.verifyNote}>Local acceptance / tax rules vary — verify before you go.</Text> : null}
                {!outcome ? (
                  <View style={styles.optActions}>
                    <Pressable testID={`choose-${o.exit_type}`} disabled={busy} style={styles.chooseBtn} onPress={() => choose(o, (o.partner_matches || [])[0]?.id)}>
                      <Text style={styles.chooseText}>{selType === o.exit_type ? "Chosen" : "Choose this"}</Text>
                    </Pressable>
                    <Pressable testID={`handled-${o.exit_type}`} disabled={busy} style={styles.handledBtn} onPress={() => setCompleteFor(o.exit_type)}>
                      <Text style={styles.handledText}>Mark handled</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}
            <Text style={styles.tinyNote}>{compare.disclaimer}</Text>
          </>
        ) : null}

        {/* listing */}
        {(selType === "private_sale" || selType === "managed_marketplace") && !outcome ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Listing</Text>
            {!listing ? (
              <Pressable testID="exit-listing-btn" disabled={busy} style={styles.primaryBtn} onPress={makeListing}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Prepare a listing</Text>}
              </Pressable>
            ) : (
              <>
                <Text style={styles.listTitle}>{listing.title}</Text>
                <Text style={styles.listBody}>{listing.description}</Text>
                <Text style={styles.listCond}>{listing.condition_summary}</Text>
                {listing.suggested_price_low != null ? <Text style={styles.listPrice}>Suggested ${listing.suggested_price_low}–${listing.suggested_price_high}</Text> : null}
                <Text style={styles.label}>Photo checklist</Text>
                {(listing.photo_checklist || []).map((p: string, i: number) => <Text key={i} style={styles.checkItem}>• {p}</Text>)}
                {listing.status !== "user_reviewed" ? (
                  <Pressable testID="exit-listing-review" disabled={busy} style={styles.primaryBtn} onPress={reviewListing}><Text style={styles.primaryBtnText}>Looks good — mark reviewed</Text></Pressable>
                ) : <Text style={styles.reviewed}>✓ Reviewed — copy this into the partner platform to post.</Text>}
              </>
            )}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={!!completeFor} transparent animationType="fade" onRequestClose={() => setCompleteFor(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Mark as {completeFor ? EXIT_LABEL[completeFor] : ""}?</Text>
            <Text style={styles.tinyNote}>This updates your home & inventory records and stops maintenance reminders for this item. History is kept.</Text>
            <Text style={styles.label}>What you got (optional)</Text>
            <TextInput testID="complete-value" value={realized} onChangeText={setRealized} keyboardType="decimal-pad" placeholder="$ amount" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <View style={styles.sheetBtns}>
              <Pressable style={[styles.sheetBtn, styles.sheetCancel]} onPress={() => setCompleteFor(null)}><Text style={styles.sheetCancelText}>Cancel</Text></Pressable>
              <Pressable testID="complete-confirm" disabled={busy} style={[styles.sheetBtn, styles.sheetGo]} onPress={doComplete}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sheetGoText}>Confirm</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.row}><Text style={styles.rowK}>{k}</Text><Text style={styles.rowV}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  itemMeta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginBottom: spacing.md },
  doneCard: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: "#27AE6018", borderColor: "#27AE6055", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  doneTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  doneSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  chipTextOn: { color: colors.brandPrimary },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  photoBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  photoText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  primaryBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: spacing.md },
  rowK: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  rowV: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, flexShrink: 1, textAlign: "right", textTransform: "capitalize" },
  tinyNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  hlCard: { width: 130, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  hlLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, marginTop: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  hlType: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: 2 },
  hlVal: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, marginTop: 2 },
  optCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  optCardOn: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  optHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  optTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  optVal: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  optMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 4, textTransform: "capitalize" },
  optWhy: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, lineHeight: 18 },
  partnerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  partnerText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  verifyNote: { color: "#F2994A", fontFamily: font.medium, fontSize: type.xs, marginTop: 6 },
  optActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  chooseBtn: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  chooseText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  handledBtn: { flex: 1, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  handledText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  listTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  listBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 4, lineHeight: 19 },
  listCond: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: 4 },
  listPrice: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, marginTop: 4 },
  checkItem: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  reviewed: { color: "#27AE60", fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md },
  modalWrap: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  sheetBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  sheetBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  sheetCancel: { borderColor: colors.border, borderWidth: 1 },
  sheetCancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  sheetGo: { backgroundColor: colors.brandPrimary },
  sheetGoText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
});
