import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const TRADES = ["Plumbing", "Electrical", "HVAC", "Structural / Framing", "Roofing", "Concrete / Masonry", "General Contractor", "Other"];

export default function ProsApply() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [trades, setTrades] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const toggleTrade = (t: string) => {
    Haptics.selectionAsync();
    setTrades((ts) => ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]);
  };

  const submit = async () => {
    if (!name.trim() || trades.length === 0 || !email.trim()) return;
    setBusy(true);
    try {
      await api("/pros/apply", {
        method: "POST", auth: false,
        body: {
          name: name.trim(), trades, location: location.trim(), bio: bio.trim(),
          phone: phone.trim(), email: email.trim(),
          specialties: specialties.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
    } catch {} finally { setBusy(false); }
  };

  if (done) {
    return (
      <View style={[styles.root, styles.center]}>
        <View style={styles.doneIcon}><MaterialCommunityIcons name="check-circle-outline" size={48} color={colors.success} /></View>
        <Text style={styles.doneTitle}>Application received</Text>
        <Text style={styles.doneSub}>Our team will review and verify your listing, then you'll start receiving matched leads.</Text>
        <Pressable testID="apply-done" style={styles.cta} onPress={() => router.back()}><Text style={styles.ctaText}>DONE</Text></Pressable>
      </View>
    );
  }

  const valid = name.trim() && trades.length > 0 && email.trim();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="apply-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>List your business</Text>
        <View style={{ width: 28 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["3xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Join the DIYhomie pro network. Get matched with homeowners whose projects are ready for a pro — with the job already scoped.</Text>

          <Text style={styles.label}>BUSINESS NAME *</Text>
          <TextInput testID="apply-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Lone Star Plumbing Co." placeholderTextColor={colors.onSurfaceTertiary} />

          <Text style={styles.label}>TRADES *</Text>
          <View style={styles.chips}>
            {TRADES.map((t) => (
              <Pressable key={t} testID={`apply-trade-${t}`} style={[styles.chip, trades.includes(t) && styles.chipActive]} onPress={() => toggleTrade(t)}>
                <Text style={[styles.chipText, trades.includes(t) && styles.chipTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>SPECIALTIES (COMMA-SEPARATED)</Text>
          <TextInput testID="apply-specialties" style={styles.input} value={specialties} onChangeText={setSpecialties} placeholder="Repipes, Water heaters, Leak detection" placeholderTextColor={colors.onSurfaceTertiary} />

          <Text style={styles.label}>SERVICE AREA</Text>
          <TextInput testID="apply-location" style={styles.input} value={location} onChangeText={setLocation} placeholder="City, State" placeholderTextColor={colors.onSurfaceTertiary} />

          <Text style={styles.label}>EMAIL *</Text>
          <TextInput testID="apply-email" style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@business.com" placeholderTextColor={colors.onSurfaceTertiary} />

          <Text style={styles.label}>PHONE</Text>
          <TextInput testID="apply-phone" style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="(555) 123-4567" placeholderTextColor={colors.onSurfaceTertiary} />

          <Text style={styles.label}>ABOUT YOUR BUSINESS</Text>
          <TextInput testID="apply-bio" style={[styles.input, styles.area]} value={bio} onChangeText={setBio} multiline placeholder="Licensed, insured, years in business, what sets you apart…" placeholderTextColor={colors.onSurfaceTertiary} />

          <Pressable testID="apply-submit" style={[styles.cta, !valid && styles.ctaDisabled]} onPress={submit} disabled={busy || !valid}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>SUBMIT APPLICATION</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  area: { minHeight: 90, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  chipTextActive: { color: colors.onBrandPrimary },
  cta: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.xl },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.5 },
  doneIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  doneTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26 },
  doneSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 21 },
});
