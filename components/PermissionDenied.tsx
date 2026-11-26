import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import { ShieldOff } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';

interface PermissionDeniedProps {
  title?: string;
  message?: string;
  /** Label for the primary action — defaults to "Open Settings" */
  actionLabel?: string;
  onDismiss?: () => void;
}

export default function PermissionDenied({
  title = 'Permission Required',
  message = 'Please allow access in your device settings to continue.',
  actionLabel = 'Open Settings',
  onDismiss,
}: PermissionDeniedProps) {
  const openSettings = () => {
    if (Platform.OS === 'android') {
      Linking.openSettings();
    } else {
      Linking.openURL('app-settings:');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconWrapper}>
        <ShieldOff size={36} color={Colors.primary} strokeWidth={1.5} />
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={openSettings}
        activeOpacity={0.85}
      >
        <Text style={styles.primaryBtnText}>{actionLabel}</Text>
      </TouchableOpacity>

      {onDismiss && (
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={onDismiss}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryBtnText}>Go Back</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 12,
    backgroundColor: Colors.background,
  },
  iconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 32,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
});
