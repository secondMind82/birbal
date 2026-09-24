import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppShell from '../components/AppShell';
import { getErrorMessage } from '../api/client';
import { Card, EmptyState } from '../components/ui';
import type { Expense, Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as expensesService from '../services/expensesService';
import * as timelinesService from '../services/timelinesService';
import type { RootStackParamList } from '../navigation/types';
import {
  EXPENSE_CATEGORIES,
  formatPaise,
  isReceivablePending,
  localDateKey,
  localMonthKey,
  monthLabel,
  periodEndsInDays,
  shiftMonth,
  todayStart,
  weekStart,
  yearStart,
} from '../utils/money';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const CATEGORY_COLORS = [
  '#7C5CDE',
  '#5FA98C',
  '#E29CC8',
  '#C0A37A',
  '#4A90D9',
  '#E0657A',
  '#E29C4A',
  '#786F85',
];

function categoryColor(category: string): string {
  const idx = EXPENSE_CATEGORIES.indexOf(category as never);
  return CATEGORY_COLORS[Math.max(0, idx) % CATEGORY_COLORS.length];
}

function sumBetween(list: Expense[], start: Date, end: Date): number {
  const s = start.getTime();
  const e = end.getTime();
  return list.reduce((acc, x) => {
    const value = new Date(x.eventDate).getTime();
    return value >= s && value < e ? acc + x.expenseAmountPaisa : acc;
  }, 0);
}

function dayTitle(dateStr: string, todayKey: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Other';
  if (localDateKey(d) === todayKey) {
    return `Today — ${d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatCard({ label, amount }: { label: string; amount: string }) {
  const styles = useAppStyles(makeStyles);
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statAmount} numberOfLines={1}>
        {amount}
      </Text>
    </View>
  );
}

function ExpenseRow({ expense, onDelete }: { expense: Expense; onDelete: () => void }) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  return (
    <View style={styles.rowCard}>
      <View style={[styles.rowDot, { backgroundColor: categoryColor(expense.expenseCategory) }]}>
        <Text style={styles.rowEmoji}>💸</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {expense.title}
        </Text>
        <Text style={styles.rowCategory}>{expense.expenseCategory}</Text>
      </View>
      <Text style={styles.rowAmount}>{formatPaise(expense.expenseAmountPaisa)}</Text>
      <Pressable accessibilityLabel="Delete expense" hitSlop={8} onPress={onDelete}>
        <Ionicons name="trash-outline" size={17} color={t.textSecondary} />
      </Pressable>
    </View>
  );
}

function ReceivableRow({
  item,
  isLast,
  onReceive,
  onIgnore,
}: {
  item: Timeline;
  isLast: boolean;
  onReceive: () => void;
  onIgnore: () => void;
}) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  return (
    <View style={[styles.receiveRow, !isLast && styles.catRowBorder]}>
      <View style={styles.receiveDot}>
        <Text style={styles.receiveEmoji}>💰</Text>
      </View>
      <View style={styles.receiveBody}>
        <Text style={styles.receiveTitle} numberOfLines={1}>
          {item.description?.trim() || item.title}
        </Text>
        <View style={styles.receiveActions}>
          <Pressable
            style={[styles.receiveChip, { borderColor: t.success }]}
            onPress={onReceive}
            hitSlop={6}>
            <Text style={[styles.receiveChipText, { color: t.success }]}>
              ✓ Received
            </Text>
          </Pressable>
          <Pressable
            style={[styles.receiveChip, { borderColor: t.border }]}
            onPress={onIgnore}
            hitSlop={6}>
            <Text style={[styles.receiveChipText, { color: t.textSecondary }]}>
              ✕ Ignore
            </Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.receiveAmount}>{formatPaise(item.expenseAmountPaisa!)}</Text>
    </View>
  );
}

export default function ExpensesScreen() {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore((s) => s.user?.id);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [receivables, setReceivables] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => localMonthKey(new Date()));

  const todayKey = useMemo(() => localDateKey(new Date()), []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) return () => { active = false; };
      (async () => {
        try {
          const [cachedExpenses, cachedReceivables] = await Promise.all([
            expensesService.getCachedExpenses(userId),
            expensesService.getCachedReceivables(userId),
          ]);
          if (active) {
            setExpenses(cachedExpenses);
            setReceivables(cachedReceivables);
            setLoading(false);
          }
        } catch {
          if (active) setLoading(false);
          return;
        }
        try {
          const uid = userId;
          await timelinesService.refreshTimelines(uid);
          const [freshExpenses, freshReceivables] = await Promise.all([
            expensesService.getCachedExpenses(uid),
            expensesService.getCachedReceivables(uid),
          ]);
          if (active) {
            setExpenses(freshExpenses);
            setReceivables(freshReceivables);
            setError(null);
          }
        } catch (e) {
          if (active) setError(getErrorMessage(e));
        }
      })();
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const monthExpenses = useMemo(
    () =>
      expenses
        .filter((e) => localMonthKey(new Date(e.eventDate)) === month)
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    [expenses, month],
  );

  // The inbox shows ONLY unresolved money owed back to the user — rows the user
  // has already resolved (received/ignored) leave the list for the entity money
  // history, keeping this a clean actionable queue.
  const monthReceivables = useMemo(
    () =>
      receivables
        .filter((r) => r.expenseAmountPaisa != null)
        .filter((r) => isReceivablePending(r.receivableStatus))
        .filter((r) => localMonthKey(new Date(r.eventDate)) === month)
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    [receivables, month],
  );

  const monthTotal = useMemo(
    () => monthExpenses.reduce((acc, e) => acc + e.expenseAmountPaisa, 0),
    [monthExpenses],
  );

  const stats = useMemo(() => {
    const now = new Date();
    const today = todayStart();
    const week = weekStart();
    const year = yearStart();
    const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      today: sumBetween(expenses, today, periodEndsInDays(today, 1)),
      week: sumBetween(expenses, week, periodEndsInDays(week, 7)),
      month: sumBetween(expenses, monthStart, nextMonthStart),
      year: sumBetween(expenses, year, yearEnd),
      monthKey: localMonthKey(now),
    };
  }, [expenses]);

  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of monthExpenses) {
      const cat = e.expenseCategory ?? 'Other';
      totals.set(cat, (totals.get(cat) ?? 0) + e.expenseAmountPaisa);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthExpenses]);

  const sections = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of monthExpenses) {
      const key = localDateKey(new Date(e.eventDate));
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, data]) => ({ key, title: dayTitle(key, todayKey), data }));
  }, [monthExpenses, todayKey]);

  const canGoNext = shiftMonth(month, 1) <= stats.monthKey;

  const handleDelete = (expense: Expense) => {
    Alert.alert('Delete Expense', `"${expense.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
          expensesService
            .deleteExpense(userId, expense.id)
            .catch((e) => setError(getErrorMessage(e)));
        },
      },
    ]);
  };

  const markReceivable = (item: Timeline, status: string) => {
    setReceivables((prev) =>
      prev.map((r) => (r.id === item.id ? { ...r, receivableStatus: status } : r)),
    );
    expensesService
      .setReceivableStatus(userId, item.id, status)
      .catch((e) => setError(getErrorMessage(e)));
  };

  if (loading) {
    return (
      <AppShell title="Expenses">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.accent} />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell title="Expenses">
      <SectionList
        stickySectionHeadersEnabled={false}
        sections={sections}
        keyExtractor={(item) => `e-${item.id}`}
        contentContainerStyle={styles.container}
        ListHeaderComponent={
          <View>
            <View style={styles.monthRow}>
              <Pressable hitSlop={8} onPress={() => setMonth((m) => shiftMonth(m, -1))}>
                <Ionicons name="chevron-back" size={22} color={t.accent} />
              </Pressable>
              <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
              <Pressable
                hitSlop={8}
                disabled={!canGoNext}
                onPress={() => setMonth((m) => shiftMonth(m, 1))}>
                <Ionicons
                  name="chevron-forward"
                  size={22}
                  color={canGoNext ? t.accent : t.border}
                />
              </Pressable>
            </View>

            <LinearGradient
              colors={t.gradient.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}>
              <Text style={styles.heroLabel}>Total Expenses</Text>
              <Text style={styles.heroAmount}>{formatPaise(monthTotal)}</Text>
              <Text style={styles.heroMeta}>
                {monthExpenses.length}{' '}
                {monthExpenses.length === 1 ? 'transaction' : 'transactions'}
              </Text>
            </LinearGradient>

            <View style={styles.statsGrid}>
              <StatCard label="Today" amount={formatPaise(stats.today)} />
              <StatCard label="This Week" amount={formatPaise(stats.week)} />
              <StatCard label="This Month" amount={formatPaise(stats.month)} />
              <StatCard label="This Year" amount={formatPaise(stats.year)} />
            </View>

            {categoryTotals.length > 0 ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Category Breakdown</Text>
                <Card>
                  {categoryTotals.map(([cat, total], i) => (
                    <View key={cat} style={[styles.catRow, i > 0 && styles.catRowBorder]}>
                      <View style={[styles.catDot, { backgroundColor: categoryColor(cat) }]} />
                      <Text style={styles.catName}>{cat}</Text>
                      <Text style={styles.catAmount}>{formatPaise(total)}</Text>
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}

            {monthReceivables.length > 0 ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Money to Receive</Text>
                <Card>
                  {monthReceivables.map((r, i) => (
                    <ReceivableRow
                      key={r.id}
                      item={r}
                      isLast={i === monthReceivables.length - 1}
                      onReceive={() => markReceivable(r, 'received')}
                      onIgnore={() => markReceivable(r, 'ignored')}
                    />
                  ))}
                </Card>
              </View>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={styles.dayHeader}>{section.title}</Text>
          ) : null
        }
        renderItem={({ item }) => <ExpenseRow expense={item} onDelete={() => handleDelete(item)} />}
        ListEmptyComponent={
          error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <EmptyState
              icon="💸"
              message={
                expenses.length === 0
                  ? 'No expenses yet. Tap + to add one.'
                  : 'No expenses in this month.'
              }
            />
          )
        }
        ListFooterComponent={<View style={styles.footerSpacer} />}
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('AddExpense')}>
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>
    </AppShell>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.lg, paddingBottom: 80, flexGrow: 1 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  monthLabel: { fontSize: 17, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  hero: {
    borderRadius: radii.lg,
    padding: spacing.xl,
    shadowColor: '#1C1530',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  heroAmount: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    marginTop: spacing.xs,
    letterSpacing: -0.6,
  },
  heroMeta: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.lg },
  statCard: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statAmount: { fontSize: 16, fontWeight: '800', color: t.text, marginTop: 4 },
  sectionBlock: { marginTop: spacing.lg },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: t.text,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },
  catRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  catRowBorder: { borderTopWidth: 1, borderTopColor: t.borderFaint },
  catDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.md },
  catName: { flex: 1, fontSize: 14, fontWeight: '600', color: t.text },
  catAmount: { fontSize: 14, fontWeight: '700', color: t.text },
  receiveRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md },
  receiveDot: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: t.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    marginTop: 2,
  },
  receiveEmoji: { fontSize: 13 },
  receiveBody: { flex: 1, marginRight: spacing.sm },
  receiveTitle: { fontSize: 14, fontWeight: '600', color: t.text },
  receiveActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  receiveChip: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  receiveChipText: { fontSize: 11, fontWeight: '700' },
  receiveAmount: { fontSize: 14, fontWeight: '800', color: t.danger, marginTop: 4 },
  dayHeader: {
    fontSize: 13,
    fontWeight: '800',
    color: t.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowDot: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowEmoji: { fontSize: 15 },
  rowBody: { flex: 1, marginRight: spacing.sm },
  rowTitle: { fontSize: 14, fontWeight: '700', color: t.text },
  rowCategory: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '800', color: t.text, marginRight: spacing.md },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabIcon: { color: t.onAccent, fontSize: 28, marginTop: -2 },
  error: { color: t.danger, textAlign: 'center', marginTop: spacing.xl },
  footerSpacer: { height: 8 },
}) as const;