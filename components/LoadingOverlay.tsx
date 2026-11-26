/**
 * LoadingOverlay.tsx
 * Full-screen modal overlay shown while Gemini processes the bill.
 *
 * Uses react-native-reanimated (already installed) for a smooth
 * pulsing ring + rotating arc — no extra dependencies needed.
 */

import { Colors } from '@/constants/Colors';
import { useEffect } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    cancelAnimation,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

// ── Spinner dimensions ────────────────────────────────────────────────────────
const RING_SIZE   = 72;   // outer ring diameter
const ARC_SIZE    = RING_SIZE;
const BORDER_W    = 4;

// ── Sub-components ────────────────────────────────────────────────────────────

/** Rotating arc that forms the "in progress" indicator. */
function SpinnerArc() {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 900, easing: Easing.linear }),
      -1,   // infinite
      false,
    );
    return () => cancelAnimation(rotation);
  }, []);

  const arcStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={[spinner.arc, arcStyle]}>
      {/* Only the top quarter is visible — creates the spinning arc effect */}
      <View style={spinner.arcInner} />
    </Animated.View>
  );
}

/** Softly pulsing background ring. */
function PulseRing() {
  const scale   = useSharedValue(1);
  const opacity = useSharedValue(0.18);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.35, { duration: 900, easing: Easing.out(Easing.ease) }),
        withTiming(1,    { duration: 900, easing: Easing.in(Easing.ease) }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.08, { duration: 900 }),
        withTiming(0.18, { duration: 900 }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity:    opacity.value,
  }));

  return <Animated.View style={[spinner.pulse, ringStyle]} />;
}

// ── Main component ────────────────────────────────────────────────────────────

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export default function LoadingOverlay({
  visible,
  message = 'Please wait…',
}: LoadingOverlayProps) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Spinner */}
          <View style={styles.spinnerWrap}>
            <PulseRing />
            {/* Static background ring */}
            <View style={styles.staticRing} />
            <SpinnerArc />
            {/* Centre logo dot */}
            <View style={styles.centreDot} />
          </View>

          {/* Message */}
          <Text style={styles.message}>{message}</Text>
          <Text style={styles.subMessage}>This may take up to 30 seconds</Text>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const spinner = StyleSheet.create({
  /* Outer pulsing ring */
  pulse: {
    position:    'absolute',
    width:       RING_SIZE + 24,
    height:      RING_SIZE + 24,
    borderRadius: (RING_SIZE + 24) / 2,
    backgroundColor: Colors.primary,
  },

  /* Static grey track */

  /* Rotating arc */
  arc: {
    position:    'absolute',
    width:       ARC_SIZE,
    height:      ARC_SIZE,
    borderRadius: ARC_SIZE / 2,
  },
  arcInner: {
    width:        ARC_SIZE,
    height:       ARC_SIZE,
    borderRadius: ARC_SIZE / 2,
    borderWidth:  BORDER_W,
    borderColor:  'transparent',
    borderTopColor: Colors.primary,
  },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius:    24,
    paddingVertical: 36,
    paddingHorizontal: 44,
    alignItems:      'center',
    gap:             14,
    minWidth:        220,
    elevation:       16,
  },

  /* Spinner wrapper — all layers stacked in here */
  spinnerWrap: {
    width:          RING_SIZE + 24,
    height:         RING_SIZE + 24,
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom:   4,
  },

  /* Static grey background ring */
  staticRing: {
    position:     'absolute',
    width:         RING_SIZE,
    height:        RING_SIZE,
    borderRadius:  RING_SIZE / 2,
    borderWidth:   BORDER_W,
    borderColor:   Colors.border,
  },

  /* Green dot in the centre */
  centreDot: {
    position:        'absolute',
    width:           14,
    height:          14,
    borderRadius:    7,
    backgroundColor: Colors.primary,
  },

  message: {
    fontSize:   16,
    fontWeight: '700',
    color:      Colors.textPrimary,
    textAlign:  'center',
    letterSpacing: -0.2,
  },
  subMessage: {
    fontSize:  12,
    color:     Colors.textMuted,
    textAlign: 'center',
  },
});
