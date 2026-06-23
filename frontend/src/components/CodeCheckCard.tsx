import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Animated, Easing, Linking, Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const CODE_KEYWORDS = [
  "deck", "footing", "foundation", "electrical", "wiring", "outlet", "gfci", "breaker", "panel",
  "circuit", "subpanel", "conduit", "plumbing", "drain", "vent", "gas", "water heater", "structural",
  "beam", "joist", "span", "egress", "stair", "railing", "handrail", "permit", "setback", "fence",
  "retaining wall", "load bearing", "roof", "framing", "septic", "grading", "frost", "rewire",
];
export function projectNeedsCode(title?: string): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return CODE_KEYWORDS.some((k) => t.includes(k));
}

type CodeResult = {
  location: string; code_basis: string; answer: string; requirements: string[];
  permit_required: boolean | null; confidence: string; citations: string[]; disclaimer: string;
};

const CONF_COLOR: Record<string, string> = { high: "#27AE60", medium: "#FF8A50", low: "#EB5757" };

export function CodeCheckCard({ projectTitle, projectId }: { projectTitle?: string; projectId?: string }) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) {
      const anim = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }));
      anim.start();
      return () => anim.stop();
    }
  }, [loading, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const hasLocation = !!(user?.location && user.location.trim());

  const run = async () => {
    const q = query.trim() || `What local code applies to: ${projectTitle}?`;
    setLoading(true); setError(null); setResult(null); setNotConfigured(false);
    try {
      const res = await api<CodeResult>("/code-check", { method: "POST", body: { query: q, project_id: projectId } });
      setResult(res);
    } catch (e: any) {
      if (e?.status === 503) setNotConfigured(true);
      else if (e?.status === 400) setError(e?.message || "Add your city or ZIP in Profile first.");
      else setError("Couldn't reach the code library. Try again.");
    } finally { setLoading(false); }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="gavel" size={20} color={colors.brandPrimary} />
        <Text style={styles.title}>CHECK YOUR LOCAL CODE</Text>
      </View>
      <Text style={styles.sub}>
        This project may need to meet building code. Get the exact rule for {hasLocation ? user!.location : "your city"} — adopted code cycle, local amendments & permits.
      </Text>

      <TextInput
        testID="code-query"
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder={`e.g. How deep must my footings be?`}
        placeholderTextColor={colors.onSurfaceTertiary}
        multiline
      />
      <Pressable testID="code-check-run" style={[styles.btn, loading && { opacity: 0.7 }]} onPress={run} disabled={loading}>
        {loading ? (
          <View style={styles.loadingRow}>
            <Animated.View style={{ transform: [{ rotate }] }}><MaterialCommunityIcons name="wrench" size={18} color={colors.onBrandPrimary} /></Animated.View>
            <Text style={styles.btnText}>SEARCHING {(user?.location || "LOCAL").toUpperCase()} CODES…</Text>
          </View>
        ) : (
          <View style={styles.loadingRow}>
            <MaterialCommunityIcons name="magnify" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.btnText}>CHECK MY LOCAL CODE</Text>
          </View>
        )}
      </Pressable>

      {notConfigured && (
        <View style={styles.infoBox}>
          <MaterialCommunityIcons name="information-outline" size={16} color={colors.info} />
          <Text style={styles.infoText}>Live local-code lookup turns on once Perplexity AI is connected.</Text>
        </View>
      )}
      {error && <Text style={styles.errText}>{error}</Text>}

      {result && (
        <View style={styles.result}>
          {!!result.code_basis && (
            <View style={styles.basisRow}>
              <View style={styles.basisChip}><Text style={styles.basisText}>{result.code_basis}</Text></View>
              <View style={[styles.confChip, { borderColor: CONF_COLOR[result.confidence] || colors.border }]}>
                <Text style={[styles.confText, { color: CONF_COLOR[result.confidence] || colors.onSurfaceTertiary }]}>{(result.confidence || "").toUpperCase()} CONFIDENCE</Text>
              </View>
            </View>
          )}
          <Text style={styles.answer}>{result.answer}</Text>
          {result.requirements?.length > 0 && result.requirements.map((r, i) => (
            <View key={i} style={styles.reqRow}>
              <MaterialCommunityIcons name="check-circle-outline" size={15} color={colors.brandPrimary} />
              <Text style={styles.reqText}>{r}</Text>
            </View>
          ))}
          {result.permit_required != null && (
            <View style={[styles.permit, { backgroundColor: (result.permit_required ? "#EB5757" : "#27AE60") + "22" }]}>
              <MaterialCommunityIcons name={result.permit_required ? "file-document-alert-outline" : "file-check-outline"} size={16} color={result.permit_required ? "#EB5757" : "#27AE60"} />
              <Text style={[styles.permitText, { color: result.permit_required ? "#EB5757" : "#27AE60" }]}>{result.permit_required ? "Permit likely required" : "Permit typically not required"}</Text>
            </View>
          )}
          {result.citations?.length > 0 && (
            <View style={styles.cites}>
              <Text style={styles.citesLabel}>SOURCES</Text>
              {result.citations.map((c, i) => (
                <Pressable key={i} onPress={() => Linking.openURL(c)}>
                  <Text style={styles.citeLink} numberOfLines={1}>{i + 1}. {c.replace(/^https?:\/\//, "")}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={styles.disclaimer}>{result.disclaimer}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 4 },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, letterSpacing: 1 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, minHeight: 44, marginBottom: spacing.sm, outlineStyle: "none" } as any,
  btn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  btnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  infoBox: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md },
  infoText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  errText: { color: colors.error, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm },
  result: { marginTop: spacing.md },
  basisRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  basisChip: { backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  basisText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm },
  confChip: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  confText: { fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  answer: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.sm },
  reqRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 3 },
  reqText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  permit: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm },
  permitText: { fontFamily: font.bold, fontSize: type.sm },
  cites: { marginTop: spacing.md, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm },
  citesLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1, marginBottom: 4 },
  citeLink: { color: colors.info, fontFamily: font.medium, fontSize: type.sm, paddingVertical: 2 },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, fontStyle: "italic", marginTop: spacing.md, lineHeight: 16 },
});
