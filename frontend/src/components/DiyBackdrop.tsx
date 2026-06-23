import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors } from "@/src/theme";

const { width, height } = Dimensions.get("window");

// Sparse, intentional scatter of DIY tools — very low opacity so it reads as a
// faint blueprint "vibe", not clutter.
const TOOLS: { name: any; top: number; left: number; size: number; rotate: string; opacity: number }[] = [
  { name: "hammer", top: 0.07, left: 0.70, size: 104, rotate: "20deg", opacity: 0.07 },
  { name: "screwdriver", top: 0.15, left: 0.06, size: 78, rotate: "-28deg", opacity: 0.055 },
  { name: "wrench", top: 0.27, left: 0.80, size: 84, rotate: "44deg", opacity: 0.05 },
  { name: "tape-measure", top: 0.40, left: 0.04, size: 70, rotate: "10deg", opacity: 0.05 },
  { name: "hand-saw", top: 0.52, left: 0.74, size: 96, rotate: "-12deg", opacity: 0.045 },
  { name: "paint-roller", top: 0.64, left: 0.10, size: 76, rotate: "24deg", opacity: 0.05 },
  { name: "ruler-square", top: 0.78, left: 0.78, size: 80, rotate: "-18deg", opacity: 0.05 },
  { name: "screw-machine-flat-top", top: 0.86, left: 0.16, size: 54, rotate: "8deg", opacity: 0.06 },
  { name: "nut", top: 0.33, left: 0.42, size: 40, rotate: "0deg", opacity: 0.05 },
  { name: "pipe-wrench", top: 0.92, left: 0.60, size: 72, rotate: "30deg", opacity: 0.045 },
];

const H_LINES = Math.ceil(height / 78);
const V_LINES = Math.ceil(width / 78);

export function DiyBackdrop() {
  return (
    <View style={styles.root} pointerEvents="none">
      {/* faint blueprint grid */}
      <View style={StyleSheet.absoluteFill}>
        {Array.from({ length: H_LINES }).map((_, i) => (
          <View key={`h${i}`} style={[styles.hLine, { top: i * 78 }]} />
        ))}
        {Array.from({ length: V_LINES }).map((_, i) => (
          <View key={`v${i}`} style={[styles.vLine, { left: i * 78 }]} />
        ))}
      </View>

      {/* scattered tool sketches */}
      {TOOLS.map((t, i) => (
        <MaterialCommunityIcons
          key={i}
          name={t.name}
          size={t.size}
          color="#FFFFFF"
          style={{
            position: "absolute",
            top: height * t.top,
            left: width * t.left,
            opacity: t.opacity,
            transform: [{ rotate: t.rotate }],
          }}
        />
      ))}

      {/* warm orange glow from the top */}
      <LinearGradient
        colors={["rgba(255,106,0,0.22)", "rgba(255,106,0,0.06)", "transparent"]}
        locations={[0, 0.4, 1]}
        style={styles.topGlow}
      />
      {/* deep fade to black so foreground text stays crisp */}
      <LinearGradient
        colors={["rgba(14,14,14,0.55)", "rgba(14,14,14,0.15)", "rgba(14,14,14,0.85)", "#0E0E0E"]}
        locations={[0, 0.4, 0.78, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* subtle orange ember at the bottom for that "workshop" warmth */}
      <LinearGradient
        colors={["transparent", "rgba(255,106,0,0.10)"]}
        style={styles.bottomEmber}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: "#0E0E0E", overflow: "hidden" },
  hLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.035)" },
  vLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: height * 0.55 },
  bottomEmber: { position: "absolute", bottom: 0, left: 0, right: 0, height: height * 0.28 },
});
