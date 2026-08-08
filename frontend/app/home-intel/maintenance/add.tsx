import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CATEGORIES = ["General", "HVAC", "Plumbing", "Electrical", "Exterior", "Appliances", "Safety", "Lawn & Garden", "Cleaning"];
const PRIORITIES = ["low", "medium", "high"];
const FREQS = [
  { key: "one_time", label: "One time" }, { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Every 3 mo" }, { key: "biannual", label: "Every 6 mo" },
  { key: "annual", label: "Yearly" }, { key: "custom", label: "Custom" },
];
const SEASONS = ["Spring", "Summer", "Fall", "Winter"];

function defaultDueDate(): string {
  const d = new Date(); d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export default function AddMaintenanceTask() {
  const router = useRouter();
  const { assetId, roomId } = useLocalSearchParams<{ assetId?: string; roomId?: string }>();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [priority, setPriority] = useState("medium");
  const [freq, setFreq] = useState("one_time");
  const [customDays, setCustomDays] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [season, setSeason] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [asset, setAsset] = useState<string | null>(assetId || null);
  const [room, setRoom] = useState<string | null>(roomId || null);
  const [assets, setAssets] = useState<{ id: string; name: string }[]>([]);
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const loadLinks = useCallback(async () => {
    try {
      const a = await api<{ assets: any[] }>("/hi/assets");
      setAssets(a.assets.map((x) => ({ id: x.id, name: x.name })));
      const m = await api<{ rooms: any[] }>("/hi/rooms/map");
      setRooms(m.rooms.map((x) => ({ id: x.id, name: x.name })));
    } catch {}
  }, []);
  useEffect(() => { loadLinks(); }, [loadLinks]);

  const save = async () => {
    if (!title.trim()) { Alert.alert("Add a title", "Name the maintenance task."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { Alert.alert("Check the date", "Use format YYYY-MM-DD."); return; }
    setBusy(true);
    try {
      await api("/hi/maintenance/tasks", { method: "POST", body: {
        title: title.trim(), category, priority, frequency_type: freq,
        custom_interval_days: freq === "custom" ? parseInt(customDays || "0", 10) || undefined : undefined,
        due_date: dueDate, notes: notes.trim() || undefined, season: season || undefined,
        asset_id: asset || undefined, room_id: room || undefined,
      } });
      router.back();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Add Maintenance Task" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Task title</Text>
          <TextInput testID="maint-title" style={styles.input} value={title} onChangeText={setTitle}
            placeholder="e.g. Replace HVAC filter" placeholderTextColor={colors.onSurfaceTertiary} />

          <Chips label="Category" options={CATEGORIES} value={category} onSelect={setCategory} prefix="maint-cat" />
          <Chips label="Priority" options={PRIORITIES} value={priority} onSelect={setPriority} prefix="maint-pri" />

          <Text style={styles.label}>Repeats</Text>
          <View style={styles.chips}>
            {FREQS.map((f) => (
              <Pressable key={f.key} testID={`maint-freq-${f.key}`} style={[styles.chip, freq === f.key && styles.chipOn]} onPress={() => setFreq(f.key)}>
                <Text style={[styles.chipText, freq === f.key && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
          {freq === "custom" && (
            <TextInput testID="maint-customdays" style={styles.input} value={customDays} onChangeText={setCustomDays}
              keyboardType="number-pad" placeholder="Every how many days?" placeholderTextColor={colors.onSurfaceTertiary} />
          )}

          <Text style={styles.label}>Next due date (YYYY-MM-DD)</Text>
          <TextInput testID="maint-due" style={styles.input} value={dueDate} onChangeText={setDueDate}
            placeholder="2026-07-01" placeholderTextColor={colors.onSurfaceTertiary} autoCapitalize="none" />

          <Text style={styles.label}>Season (optional)</Text>
          <View style={styles.chips}>
            {SEASONS.map((s) => (
              <Pressable key={s} testID={`maint-season-${s}`} style={[styles.chip, season === s && styles.chipOn]} onPress={() => setSeason(season === s ? null : s)}>
                <Text style={[styles.chipText, season === s && styles.chipTextOn]}>{s}</Text>
              </Pressable>
            ))}
          </View>

          {assets.length > 0 && (
            <>
              <Text style={styles.label}>Link to an asset (optional)</Text>
              <View style={styles.chips}>
                {assets.map((a) => (
                  <Pressable key={a.id} testID={`maint-asset-${a.id}`} style={[styles.chip, asset === a.id && styles.chipOn]} onPress={() => setAsset(asset === a.id ? null : a.id)}>
                    <Text style={[styles.chipText, asset === a.id && styles.chipTextOn]}>{a.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {rooms.length > 0 && (
            <>
              <Text style={styles.label}>Link to a room (optional)</Text>
              <View style={styles.chips}>
                {rooms.map((rm) => (
                  <Pressable key={rm.id} testID={`maint-room-${rm.id}`} style={[styles.chip, room === rm.id && styles.chipOn]} onPress={() => setRoom(room === rm.id ? null : rm.id)}>
                    <Text style={[styles.chipText, room === rm.id && styles.chipTextOn]}>{rm.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput testID="maint-notes" style={[styles.input, { minHeight: 80 }]} value={notes} onChangeText={setNotes}
            multiline textAlignVertical="top" placeholder="Anything to remember" placeholderTextColor={colors.onSurfaceTertiary} />

          <Pressable testID="maint-save" style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.btnText}>Save task</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Chips({ label, options, value, onSelect, prefix }: { label: string; options: string[]; value: string; onSelect: (v: string) => void; prefix: string }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <Pressable key={o} testID={`${prefix}-${o}`} style={[styles.chip, value === o && styles.chipOn]} onPress={() => onSelect(o)}>
            <Text style={[styles.chipText, value === o && styles.chipTextOn, { textTransform: "capitalize" }]}>{o}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  btn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  btnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
});
