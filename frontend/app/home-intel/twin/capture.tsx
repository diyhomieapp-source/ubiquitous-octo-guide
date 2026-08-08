import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CAPTURE_TYPES = [
  { key: "walkthrough", label: "Room walkthrough", icon: "walk" },
  { key: "manual", label: "Manual entry", icon: "pencil-ruler" },
  { key: "photo", label: "Photos", icon: "camera-outline" },
];
const ROOM_TYPES = ["Kitchen", "Bathroom", "Bedroom", "Living Room", "Garage", "Basement", "Hallway", "Other"];
const ELEMENTS = ["wall", "door", "window", "cabinet", "appliance", "other"];

export default function TwinCapture() {
  const router = useRouter();
  const [sid, setSid] = useState<string | null>(null);
  const [captureType, setCaptureType] = useState("walkthrough");
  const [rooms, setRooms] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  // add-room fields
  const [rName, setRName] = useState(""); const [rType, setRType] = useState("Kitchen"); const [rArea, setRArea] = useState("");
  // add-measurement fields
  const [selRoom, setSelRoom] = useState<string | null>(null);
  const [mLabel, setMLabel] = useState(""); const [mElem, setMElem] = useState("wall"); const [mVal, setMVal] = useState("");

  const refresh = useCallback(async () => {
    if (!sid) return;
    try { const d = await api<any>(`/hi/twin/capture-sessions/${sid}`); setRooms(d.rooms || []); } catch {}
  }, [sid]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const startSession = async () => {
    setBusy(true);
    try { const s = await api<any>("/hi/twin/capture-sessions", { method: "POST", body: { capture_type: captureType } }); setSid(s.id); }
    catch (e: any) { Alert.alert("Couldn't start", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const addRoom = async () => {
    if (!rName.trim()) { Alert.alert("Name it", "Give the room a name."); return; }
    setBusy(true);
    try {
      await api(`/hi/twin/capture-sessions/${sid}/rooms`, { method: "POST", body: { room_type: rType, display_name: rName.trim(), area_estimate: rArea ? parseFloat(rArea) : undefined } });
      setRName(""); setRArea(""); await refresh();
    } catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const addMeasurement = async () => {
    if (!selRoom) { Alert.alert("Pick a room", "Choose which room this measures."); return; }
    if (!mLabel.trim() || !mVal) { Alert.alert("Add details", "Enter a label and a value."); return; }
    setBusy(true);
    try {
      const res = await api<any>(`/hi/twin/capture-sessions/${sid}/measurements`, { method: "POST",
        body: { dt_room_id: selRoom, element_type: mElem, label: mLabel.trim(), value: parseFloat(mVal), unit: "feet", source_status: captureType === "photo" ? "photo_detected" : "manual" } });
      setMLabel(""); setMVal("");
      if (res.conflict) Alert.alert("Conflict saved", "This differs from a confirmed value — review it later. Your confirmed value was kept.");
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const complete = async () => {
    setBusy(true);
    try { await api(`/hi/twin/capture-sessions/${sid}/complete`, { method: "POST" }); router.replace("/home-intel/twin"); }
    catch (e: any) { Alert.alert("Couldn't finish", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Capture" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {!sid ? (
          <>
            <Text style={styles.label}>How do you want to capture?</Text>
            {CAPTURE_TYPES.map((c) => (
              <Pressable key={c.key} testID={`ct-${c.key}`} style={[styles.typeCard, captureType === c.key && styles.typeOn]} onPress={() => setCaptureType(c.key)}>
                <MaterialCommunityIcons name={c.icon as any} size={22} color={captureType === c.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.typeText, captureType === c.key && { color: colors.brandPrimary }]}>{c.label}</Text>
                {captureType === c.key && <MaterialCommunityIcons name="check-circle" size={18} color={colors.brandPrimary} />}
              </Pressable>
            ))}
            <Pressable testID="twin-begin" style={styles.primary} disabled={busy} onPress={startSession}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Begin capture</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.section}>Add a room</Text>
            <TextInput testID="tr-name" style={styles.input} value={rName} onChangeText={setRName} placeholder="Room name" placeholderTextColor={colors.onSurfaceTertiary} />
            <View style={styles.wrap}>
              {ROOM_TYPES.map((t) => (
                <Pressable key={t} style={[styles.chip, rType === t && styles.chipOn]} onPress={() => setRType(t)}>
                  <Text style={[styles.chipText, rType === t && { color: "#fff" }]}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput testID="tr-area" style={[styles.input, { marginTop: spacing.sm }]} value={rArea} onChangeText={setRArea} keyboardType="decimal-pad" placeholder="Approx. area (sq ft, optional)" placeholderTextColor={colors.onSurfaceTertiary} />
            <Pressable testID="tr-add" style={styles.outline} disabled={busy} onPress={addRoom}><Text style={styles.outlineText}>Add room</Text></Pressable>

            {rooms.length > 0 && (
              <>
                <Text style={styles.section}>Add a measurement</Text>
                <Text style={styles.help}>Pick a room, then log a wall/door/window length.</Text>
                <View style={styles.wrap}>
                  {rooms.map((rm) => (
                    <Pressable key={rm.id} style={[styles.chip, selRoom === rm.id && styles.chipOn]} onPress={() => setSelRoom(rm.id)}>
                      <Text style={[styles.chipText, selRoom === rm.id && { color: "#fff" }]}>{rm.display_name}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.wrap}>
                  {ELEMENTS.map((e) => (
                    <Pressable key={e} style={[styles.chip, mElem === e && styles.chipOn]} onPress={() => setMElem(e)}>
                      <Text style={[styles.chipText, mElem === e && { color: "#fff" }]}>{e}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.row}>
                  <TextInput testID="tm-label" style={[styles.input, { flex: 2 }]} value={mLabel} onChangeText={setMLabel} placeholder="Label (e.g. North wall)" placeholderTextColor={colors.onSurfaceTertiary} />
                  <TextInput testID="tm-val" style={[styles.input, { flex: 1, textAlign: "center" }]} value={mVal} onChangeText={setMVal} keyboardType="decimal-pad" placeholder="ft" placeholderTextColor={colors.onSurfaceTertiary} />
                </View>
                <Pressable testID="tm-add" style={styles.outline} disabled={busy} onPress={addMeasurement}><Text style={styles.outlineText}>Add measurement</Text></Pressable>
              </>
            )}

            <Pressable testID="twin-complete" style={styles.primary} disabled={busy} onPress={complete}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Finish capture</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.xs },
  typeCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  typeOn: { borderColor: colors.brandPrimary },
  typeText: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  outline: { alignItems: "center", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  outlineText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xl, minHeight: 48 },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
