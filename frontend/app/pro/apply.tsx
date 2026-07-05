import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const TRADES = ["General Contractor", "Electrical", "Plumbing", "HVAC", "Roofing", "Painting", "Carpentry", "Landscaping", "Flooring", "Remodeling", "Handyman", "Designer"];

export default function ProApply() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [trades, setTrades] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState("");
  const [location, setLocation] = useState(user?.location || "");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [license, setLicense] = useState("");
  const [insurance, setInsurance] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleTrade = (t: string) => setTrades((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);

  const submit = async () => {
    if (!name.trim() || trades.length === 0 || saving) { Alert.alert("Almost there", "Add your name and at least one trade."); return; }
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api("/pro/apply", { method: "POST", body: {
        name: name.trim(), trades, specialties: specialties.split(",").map((s) => s.trim()).filter(Boolean),
        location: location.trim(), bio: bio.trim(), phone: phone.trim(),
        license_number: license.trim(), insurance: insurance.trim(),
      } });
      await refresh();
      Alert.alert("Application received", "Our team will verify your credentials shortly.", [{ text: "OK", onPress: () => router.replace("/pro") }]);
    } catch (e: any) { Alert.alert("Couldn't submit", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="apply-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Become a Pro</Text>
        <View style={{ width: 28 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Tell us about your business. We verify license & insurance before you go live.</Text>

        <Field label="Business / your name"><TextInput testID="apply-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Lone Star Remodeling" placeholderTextColor={colors.onSurfaceTertiary} /></Field>

        <Text style={styles.label}>Trades *</Text>
        <View style={styles.chips}>
          {TRADES.map((t) => (
            <Pressable key={t} testID={`apply-trade-${t}`} style={[styles.chip, trades.includes(t) && styles.chipOn]} onPress={() => toggleTrade(t)}>
              <Text style={[styles.chipText, trades.includes(t) && styles.chipTextOn]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <Field label="Specialties (comma-separated)"><TextInput testID="apply-specialties" style={styles.input} value={specialties} onChangeText={setSpecialties} placeholder="Decks, Fences, Kitchens" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
        <Field label="Service area"><TextInput testID="apply-location" style={styles.input} value={location} onChangeText={setLocation} placeholder="Austin, TX" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
        <Field label="Phone"><TextInput testID="apply-phone" style={styles.input} value={phone} onChangeText={setPhone} placeholder="(512) 555-0100" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="phone-pad" /></Field>
        <Field label="License number"><TextInput testID="apply-license" style={styles.input} value={license} onChangeText={setLicense} placeholder="TX-000000" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
        <Field label="Insurance provider / policy"><TextInput testID="apply-insurance" style={styles.input} value={insurance} onChangeText={setInsurance} placeholder="Acme Insurance · $1M GL" placeholderTextColor={colors.onSurfaceTertiary} /></Field>
        <Field label="About your work"><TextInput testID="apply-bio" style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} value={bio} onChangeText={setBio} placeholder="Years in business, what you're known for…" placeholderTextColor={colors.onSurfaceTertiary} multiline /></Field>

        <Pressable testID="apply-submit" style={[styles.submit, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>SUBMIT APPLICATION</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Text style={styles.label}>{label}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.onBrandPrimary, fontFamily: font.bold },
  submit: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.md },
  submitText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
});
