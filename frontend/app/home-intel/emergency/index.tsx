import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Modal } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const labelize = (s: string) => s.replace(/_/g, " ");

export default function EmergencyHub() {
  const router = useRouter();
  const [ov, setOv] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactTypes, setContactTypes] = useState<string[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [locationTypes, setLocationTypes] = useState<string[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [planTypes, setPlanTypes] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // modals
  const [cModal, setCModal] = useState(false);
  const [cType, setCType] = useState("plumber");
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [lModal, setLModal] = useState(false);
  const [lType, setLType] = useState("water_shutoff");
  const [lDesc, setLDesc] = useState("");
  const [pModal, setPModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, c, l, p, i] = await Promise.all([
        api<any>("/hi/emergency/overview"), api<any>("/hi/emergency/contacts"), api<any>("/hi/emergency/locations"),
        api<any>("/hi/emergency/prep-plans"), api<any>("/hi/emergency/incidents"),
      ]);
      setOv(o); setContacts(c.contacts || []); setContactTypes(c.contact_types || []);
      setLocations(l.locations || []); setLocationTypes(l.location_types || []);
      setPlans(p.plans || []); setPlanTypes(p.plan_types || []); setIncidents(i.incidents || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addContact = async () => {
    if (!cName.trim()) { Alert.alert("Name needed", "Add a name."); return; }
    setBusy(true);
    try { await api("/hi/emergency/contacts", { method: "POST", body: { contact_type: cType, name: cName, phone: cPhone || null } }); setCModal(false); setCName(""); setCPhone(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const delContact = (id: string) => { api(`/hi/emergency/contacts/${id}`, { method: "DELETE" }).then(load).catch(() => {}); };
  const addLocation = async () => {
    if (!lDesc.trim()) { Alert.alert("Details needed", "Describe where it is."); return; }
    setBusy(true);
    try { await api("/hi/emergency/locations", { method: "POST", body: { location_type: lType, description: lDesc } }); setLModal(false); setLDesc(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const delLocation = (id: string) => { api(`/hi/emergency/locations/${id}`, { method: "DELETE" }).then(load).catch(() => {}); };
  const createPlan = async (planType: string) => {
    setBusy(true);
    try { const r = await api<any>("/hi/emergency/prep-plans", { method: "POST", body: { plan_type: planType } }); setPModal(false); await load(); router.push(`/home-intel/emergency/plan/${r.plan.id}`); }
    catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !ov) return <View style={styles.root}><ScreenHeader title="Property Risk" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Property Risk" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Pressable testID="er-emergency-mode" style={styles.sosBtn} onPress={() => router.push("/home-intel/emergency/mode")}>
          <MaterialCommunityIcons name="alarm-light-outline" size={24} color="#fff" />
          <View style={{ flex: 1 }}><Text style={styles.sosTitle}>Emergency Mode</Text><Text style={styles.sosSub}>Quick safety steps & your saved info</Text></View>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#fff" />
        </Pressable>

        {ov.suggestions?.length > 0 && (
          <>
            <Text style={styles.section}>Get ready</Text>
            {ov.suggestions.map((s: any, i: number) => (
              <View key={i} style={styles.suggRow}>
                <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={16} color={colors.brandPrimary} />
                <Text style={styles.suggText}>{s.label}</Text>
              </View>
            ))}
            <Text style={styles.completeness}>Emergency info completeness: {ov.info_completeness}%</Text>
          </>
        )}

        {/* Contacts */}
        <View style={styles.secHead}><Text style={styles.section}>Emergency contacts</Text><Pressable testID="er-add-contact" onPress={() => setCModal(true)}><MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.brandPrimary} /></Pressable></View>
        {contacts.length === 0 ? <Text style={styles.empty}>No contacts added yet.</Text> :
          contacts.map((c) => (
            <View key={c.id} style={styles.row}>
              <View style={{ flex: 1 }}><Text style={styles.rTitle}>{c.name}</Text><Text style={styles.rMeta}>{labelize(c.contact_type)}{c.phone ? ` · ${c.phone}` : ""}</Text></View>
              <Pressable testID={`er-del-contact-${c.id}`} onPress={() => delContact(c.id)}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
            </View>
          ))}

        {/* Locations */}
        <View style={styles.secHead}><Text style={styles.section}>Shutoffs & key locations</Text><Pressable testID="er-add-location" onPress={() => setLModal(true)}><MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.brandPrimary} /></Pressable></View>
        {locations.length === 0 ? <Text style={styles.empty}>No locations recorded yet.</Text> :
          locations.map((l) => (
            <View key={l.id} style={styles.row}>
              <View style={{ flex: 1 }}><Text style={styles.rTitle}>{labelize(l.location_type)}</Text><Text style={styles.rMeta}>{l.description}</Text></View>
              <Pressable testID={`er-del-location-${l.id}`} onPress={() => delLocation(l.id)}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
            </View>
          ))}

        {/* Prep plans */}
        <View style={styles.secHead}><Text style={styles.section}>Preparedness plans</Text><Pressable testID="er-add-plan" onPress={() => setPModal(true)}><MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.brandPrimary} /></Pressable></View>
        {plans.length === 0 ? <Text style={styles.empty}>Create a checklist for storms, outages, or travel.</Text> :
          plans.map((p) => (
            <Pressable key={p.id} testID={`er-plan-${p.id}`} style={styles.row} onPress={() => router.push(`/home-intel/emergency/plan/${p.id}`)}>
              <View style={{ flex: 1 }}><Text style={styles.rTitle}>{p.label}</Text><Text style={styles.rMeta}>{p.done_items}/{p.total_items} done · {p.status}</Text></View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}

        {/* Incidents */}
        {incidents.length > 0 && (
          <>
            <Text style={styles.section}>Incident history</Text>
            {incidents.map((inc) => (
              <Pressable key={inc.id} testID={`er-incident-${inc.id}`} style={styles.row} onPress={() => router.push(`/home-intel/emergency/incident/${inc.id}`)}>
                <View style={{ flex: 1 }}><Text style={styles.rTitle}>{labelize(inc.incident_type)}</Text><Text style={styles.rMeta}>{inc.status} · {String(inc.occurred_at).slice(0, 10)}</Text></View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </>
        )}
        <Text style={styles.note}>{ov.note}</Text>
      </ScrollView>

      {/* Contact modal */}
      <Modal visible={cModal} transparent animationType="slide" onRequestClose={() => setCModal(false)}>
        <View style={styles.mWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Add emergency contact</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: spacing.sm }}>
            {contactTypes.map((t) => <Pressable key={t} testID={`er-ctype-${t}`} style={[styles.chip, cType === t && styles.chipOn]} onPress={() => setCType(t)}><Text style={[styles.chipText, cType === t && styles.chipTextOn]}>{labelize(t)}</Text></Pressable>)}
          </ScrollView>
          <TextInput testID="er-contact-name" value={cName} onChangeText={setCName} placeholder="Name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="er-contact-phone" value={cPhone} onChangeText={setCPhone} placeholder="Phone (optional)" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="phone-pad" style={styles.input} />
          <SheetBtns onCancel={() => setCModal(false)} onSave={addContact} busy={busy} tid="er-contact-save" />
        </View></View>
      </Modal>

      {/* Location modal */}
      <Modal visible={lModal} transparent animationType="slide" onRequestClose={() => setLModal(false)}>
        <View style={styles.mWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Add a location</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: spacing.sm }}>
            {locationTypes.map((t) => <Pressable key={t} testID={`er-ltype-${t}`} style={[styles.chip, lType === t && styles.chipOn]} onPress={() => setLType(t)}><Text style={[styles.chipText, lType === t && styles.chipTextOn]}>{labelize(t)}</Text></Pressable>)}
          </ScrollView>
          <TextInput testID="er-location-desc" value={lDesc} onChangeText={setLDesc} placeholder="Where is it? e.g. Basement by the heater" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <SheetBtns onCancel={() => setLModal(false)} onSave={addLocation} busy={busy} tid="er-location-save" />
        </View></View>
      </Modal>

      {/* Plan picker modal */}
      <Modal visible={pModal} transparent animationType="slide" onRequestClose={() => setPModal(false)}>
        <View style={styles.mWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Start a preparedness plan</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {planTypes.map((t) => <Pressable key={t.key} testID={`er-plantype-${t.key}`} disabled={busy} style={styles.planPick} onPress={() => createPlan(t.key)}><Text style={styles.planPickText}>{t.label}</Text><MaterialCommunityIcons name="chevron-right" size={20} color={colors.brandPrimary} /></Pressable>)}
          </ScrollView>
          <Pressable style={[styles.sheetBtn, styles.cancel]} onPress={() => setPModal(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

function SheetBtns({ onCancel, onSave, busy, tid }: any) {
  return (
    <View style={styles.sheetBtns}>
      <Pressable style={[styles.sheetBtn, styles.cancel]} onPress={onCancel}><Text style={styles.cancelText}>Cancel</Text></Pressable>
      <Pressable testID={tid} disabled={busy} style={[styles.sheetBtn, styles.go, busy && { opacity: 0.5 }]} onPress={onSave}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.goText}>Save</Text>}</Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  sosBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#EB5757", borderRadius: radius.md, padding: spacing.lg },
  sosTitle: { color: "#fff", fontFamily: font.bold, fontSize: type.lg },
  sosSub: { color: "#fff", opacity: 0.9, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  secHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  suggRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  suggText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
  completeness: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.lg },
  mWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.sm },
  sheetBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  sheetBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  cancel: { borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  go: { backgroundColor: colors.brandPrimary },
  goText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  planPick: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  planPickText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
});
