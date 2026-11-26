import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { PlusCircle, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';

interface ManualEntryCardProps {
  onPress: () => void;
}

export default function ManualEntryCard({ onPress }: ManualEntryCardProps) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <View style={styles.iconWrapper}>
        <FileText size={26} color={Colors.primary} strokeWidth={1.8} />
      </View>

      <View style={styles.textBlock}>
        <Text style={styles.title}>Manual Bill Entry</Text>
        <Text style={styles.subtitle}>Type in items and amounts manually</Text>
      </View>

      <View style={styles.addButton}>
        <PlusCircle size={22} color={Colors.primary} strokeWidth={2} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 24,
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: Colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
      },
    }),
  },
  iconWrapper: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
