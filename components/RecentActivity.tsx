import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Clock, Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';

export interface ActivityItem {
  id: string;
  title: string;
  date: string;
  total: string;
  splitCount: number;
  yourShare: string;
}

interface RecentActivityProps {
  items?: ActivityItem[];
}

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconOuter}>
        <View style={styles.emptyIconInner}>
          <Receipt size={36} color={Colors.primary} strokeWidth={1.5} />
        </View>
      </View>
      <Text style={styles.emptyTitle}>No splits yet</Text>
      <Text style={styles.emptySubtitle}>
        Your recent bill splits will appear here once you scan or enter a bill.
      </Text>
    </View>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Receipt size={20} color={Colors.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowMeta}>
          {item.date} · {item.splitCount} people
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowTotal}>{item.total}</Text>
        <Text style={styles.rowShare}>Your share: {item.yourShare}</Text>
      </View>
    </View>
  );
}

export default function RecentActivity({ items = [] }: RecentActivityProps) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Clock size={18} color={Colors.textPrimary} strokeWidth={2} />
        <Text style={styles.heading}>Recent Activity</Text>
      </View>

      <View style={styles.card}>
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((item, index) => (
            <View key={item.id}>
              <ActivityRow item={item} />
              {index < items.length - 1 && <View style={styles.divider} />}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  heading: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
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
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyIconOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(22, 131, 74, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 240,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  rowMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  rowTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  rowShare: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
  },
});
