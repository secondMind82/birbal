import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AppShell from '../components/AppShell';
import { Card, EmptyState } from '../components/ui';
import { getErrorMessage } from '../api/client';
import type { Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as timelinesService from '../services/timelinesService';
import * as expensesService from '../services/expensesService';
import { formatPaise, isReceivablePending } from '../utils/money';
import { classifyCreditDueDate, type CreditDueGroup } from '../utils/creditDueDate';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type ReminderGroup = 'Overdue' | 'Due Today' | 'Upcoming' | 'No Due Date';
const GROUPS: ReminderGroup[] = ['Overdue', 'Due Today', 'Upcoming', 'No Due Date'];

function counterparty(item: Timeline): string {
  const person = item.entities?.find((link) => link.entity.type.toUpperCase() === 'PERSON');
  if (person) return person.entity.name;
  const match = (item.description ?? '').match(/\b(?:lent|loaned)\s+(?:to\s+)?@?([\p{L}][\p{L}'’-]*)/iu);
  return match?.[1] ?? (item.description?.trim() || item.title);
}

function displayDueDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function CreditCard({ item, group, onReceived }: { item: Timeline; group: CreditDueGroup; onReceived: () => void }) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  return (
    <Card style={styles.creditCard}>
      <View style={styles.cardTop}>
        <View style={styles.personIcon}>
          <Ionicons name="person-outline" size={19} color={t.accent} />
        </View>
        <View style={styles.personBody}>
          <Text style={styles.personName} numberOfLines={1}>{counterparty(item)}</Text>
          <Text style={styles.status}>
            {group === 'No Due Date' ? 'Pending · No due date' : `${group} · Due ${displayDueDate(item.creditDueDate!)}`}
          </Text>
        </View>
        <Text style={styles.amount}>{formatPaise(item.expenseAmountPaisa)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Mark ${counterparty(item)} credit as received`}
        style={({ pressed }) => [styles.receiveButton, pressed && { opacity: 0.8 }]}
        onPress={onReceived}>
        <Ionicons name="checkmark-circle-outline" size={18} color={t.success} />
        <Text style={styles.receiveText}>Mark as Received</Text>
      </Pressable>
    </Card>
  );
}

export default function RemindersScreen() {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const userId = useAuthStore((s) => s.user?.id);
  const [items, setItems] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const cached = await timelinesService.getCachedTimelines(userId);
      setItems(cached.filter((item) =>
        item.moneyType === 'receive' && item.expenseAmountPaisa != null && isReceivablePending(item.receivableStatus),
      ));
      setLoading(false);
      try {
        const fresh = await timelinesService.refreshTimelines(userId);
        setItems(fresh.filter((item) =>
          item.moneyType === 'receive' && item.expenseAmountPaisa != null && isReceivablePending(item.receivableStatus),
        ));
        setError(null);
      } catch (e) {
        setError(getErrorMessage(e));
      }
    } catch (e) {
      setError(getErrorMessage(e));
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const grouped = useMemo(() => {
    const groups: Record<CreditDueGroup, Timeline[]> = {
      Overdue: [],
      'Due Today': [],
      Upcoming: [],
      'No Due Date': [],
    };
    for (const item of items) groups[classifyCreditDueDate(item.creditDueDate)].push(item);
    for (const group of GROUPS) {
      groups[group].sort((a, b) =>
        group === 'No Due Date'
          ? b.eventDate.localeCompare(a.eventDate)
          : (a.creditDueDate ?? '').localeCompare(b.creditDueDate ?? ''),
      );
    }
    return groups;
  }, [items]);

  const markReceived = (item: Timeline) => {
    if (!userId) return;
    setItems((previous) => previous.filter((row) => row.id !== item.id));
    void expensesService.setReceivableStatus(userId, item.id, 'received').then((updated) => {
      if (!updated) throw new Error('Credit could not be updated');
    }).catch((e) => {
      setError(getErrorMessage(e));
      void load();
    });
  };

  if (loading) {
    return <AppShell title="Reminders"><View style={styles.center}><ActivityIndicator size="large" color={t.accent} /></View></AppShell>;
  }

  return (
    <AppShell title="Reminders">
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headingRow}>
          <View style={styles.headingIcon}><Ionicons name="notifications-outline" size={20} color={t.accent} /></View>
          <View style={styles.headingBody}>
            <Text style={styles.title}>Money to receive</Text>
            <Text style={styles.subtitle}>{items.length} pending {items.length === 1 ? 'credit' : 'credits'}</Text>
          </View>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {items.length === 0 ? (
          <Card><EmptyState icon="✓" message="No pending credits. New money lent to people will appear here." /></Card>
        ) : GROUPS.map((group) => (
          <View key={group} style={styles.section}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>{group}</Text>
              <Text style={styles.sectionCount}>{grouped[group].length}</Text>
            </View>
            {grouped[group].length === 0 ? (
              group === 'No Due Date' ? null : <Text style={styles.emptyGroup}>Nothing here</Text>
            ) : grouped[group].map((item) => (
              <CreditCard key={item.id} item={item} group={group} onReceived={() => markReceived(item)} />
            ))}
          </View>
        ))}
      </ScrollView>
    </AppShell>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
  container: { padding: spacing.lg, paddingBottom: 80, flexGrow: 1 },
  headingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, marginBottom: spacing.xl },
  headingIcon: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: t.accentSoft, alignItems: 'center' as const, justifyContent: 'center' as const },
  headingBody: { flex: 1 },
  title: { color: t.text, fontSize: 22, fontWeight: '800' as const },
  subtitle: { color: t.textSecondary, fontSize: 13, marginTop: 3 },
  section: { marginBottom: spacing.lg },
  sectionHeading: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: spacing.sm, gap: spacing.sm },
  sectionTitle: { color: t.text, fontSize: 16, fontWeight: '800' as const },
  sectionCount: { minWidth: 23, paddingHorizontal: 7, paddingVertical: 2, textAlign: 'center' as const, overflow: 'hidden' as const, borderRadius: radii.full, backgroundColor: t.accentSoft, color: t.accent, fontSize: 12, fontWeight: '700' as const },
  emptyGroup: { color: t.textSecondary, fontSize: 13, paddingVertical: spacing.sm },
  creditCard: { marginBottom: spacing.sm },
  cardTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  personIcon: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: t.accentSoft, alignItems: 'center' as const, justifyContent: 'center' as const },
  personBody: { flex: 1 },
  personName: { color: t.text, fontSize: 16, fontWeight: '700' as const },
  status: { color: t.textSecondary, fontSize: 12, marginTop: 3 },
  amount: { color: t.text, fontSize: 18, fontWeight: '800' as const },
  receiveButton: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 7, borderWidth: 1, borderColor: t.success, borderRadius: radii.full, paddingVertical: 10, marginTop: spacing.md },
  receiveText: { color: t.success, fontSize: 13, fontWeight: '700' as const },
  error: { color: t.danger, fontSize: 13, marginBottom: spacing.md },
});
