import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Camera, Scan } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';

interface ScanBillCardProps {
  onPress: () => void;
}

export default function ScanBillCard({ onPress }: ScanBillCardProps) {
  return (
    <View style={styles.card}>
      {/* Background decoration circles */}
      <View style={styles.decorCircle1} />
      <View style={styles.decorCircle2} />

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Camera size={40} color={Colors.white} strokeWidth={1.5} />
          <View style={styles.scanOverlay}>
            <Scan size={22} color={Colors.primaryLight} strokeWidth={2} />
          </View>
        </View>

        <View style={styles.textBlock}>
          <Text style={styles.title}>Scan Your Bill</Text>
          <Text style={styles.subtitle}>
            Point your camera at any receipt and let AI split it instantly
          </Text>
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={onPress}
          activeOpacity={0.85}
        >
          <Camera size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.buttonText}>Scan Bill</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.primary,
    borderRadius: 20,
    padding: 24,
    overflow: 'hidden',
    marginBottom: 16,
    ...Platform.select({
      android: { elevation: 6 },
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
    }),
  },
  decorCircle1: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.07)',
    top: -40,
    right: -40,
  },
  decorCircle2: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -20,
    left: 20,
  },
  content: {
    gap: 16,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 6,
  },
  textBlock: {
    gap: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.white,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 20,
    maxWidth: '90%',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 24,
    gap: 8,
    marginTop: 4,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.2,
  },
});
