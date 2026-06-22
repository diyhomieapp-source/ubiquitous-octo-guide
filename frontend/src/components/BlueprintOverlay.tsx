import { StyleSheet, View } from "react-native";
import Svg, { Rect, Line, Path, Circle, G } from "react-native-svg";

/**
 * A faint white architectural floor-plan that sits behind the dark UI.
 * Visible enough to feel like a blueprint, light enough to never hurt readability.
 */
export function BlueprintOverlay({ opacity = 0.07 }: { opacity?: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <G stroke="#FFFFFF" fill="none">
          {/* Outer walls */}
          <Rect x="30" y="90" width="330" height="500" strokeWidth={3} />
          <Rect x="34" y="94" width="322" height="492" strokeWidth={1} />

          {/* Interior partitions → rooms */}
          <Line x1="200" y1="90" x2="200" y2="360" strokeWidth={2.5} />
          <Line x1="30" y1="360" x2="200" y2="360" strokeWidth={2.5} />
          <Line x1="200" y1="430" x2="360" y2="430" strokeWidth={2.5} />
          <Line x1="120" y1="430" x2="120" y2="590" strokeWidth={2.5} />

          {/* Door openings + swing arcs */}
          <Path d="M200 300 A40 40 0 0 1 160 340" strokeWidth={1.5} />
          <Line x1="200" y1="300" x2="200" y2="340" strokeWidth={1.5} />
          <Path d="M120 470 A36 36 0 0 0 156 506" strokeWidth={1.5} />
          <Line x1="120" y1="470" x2="120" y2="506" strokeWidth={1.5} />

          {/* Windows (double lines on walls) */}
          <Line x1="80" y1="90" x2="150" y2="90" strokeWidth={4} />
          <Line x1="80" y1="86" x2="150" y2="86" strokeWidth={1} />
          <Line x1="260" y1="590" x2="330" y2="590" strokeWidth={4} />

          {/* Fixtures: counter + tub */}
          <Rect x="44" y="380" width="60" height="120" strokeWidth={1.5} />
          <Rect x="250" y="445" width="95" height="55" rx="8" strokeWidth={1.5} />
          <Circle cx="297" cy="472" r="6" strokeWidth={1.5} />

          {/* Dimension line with end ticks */}
          <Line x1="30" y1="630" x2="360" y2="630" strokeWidth={1} />
          <Line x1="30" y1="622" x2="30" y2="638" strokeWidth={1} />
          <Line x1="360" y1="622" x2="360" y2="638" strokeWidth={1} />
          <Line x1="200" y1="622" x2="200" y2="638" strokeWidth={1} />

          {/* Grid ticks bottom */}
          <Line x1="30" y1="690" x2="360" y2="690" strokeWidth={0.75} />
          <Line x1="30" y1="730" x2="360" y2="730" strokeWidth={0.75} />
        </G>
      </Svg>
    </View>
  );
}
