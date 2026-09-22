import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppShell from '../components/AppShell';
import { getErrorMessage } from '../api/client';
import { EmptyState } from '../components/ui';
import type { DiaryEntry } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as diaryService from '../services/diaryService';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Nav = NativeStackNavigationProp<import('../navigation/types').RootStackParamList>;

const MOODS: Record<string, string> = {
  HAPPY: '😊',
  SAD: '😢',
  EXCITED: '🤩',
  CALM: '😌',
  ANXIOUS: '😰',
  GRATEFUL: '🙏',
};

export default function DiaryScreen() {
  const navigation = useNavigation<Nav>();
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userId = useAuthStore((s) => s.user?.id);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) return () => { active = false; };

      (async () => {
        try {
          const cached = await diaryService.getCachedDiary(userId);
          if (active) {
            setEntries([...cached].sort((a, b) => b.entryDate.localeCompare(a.entryDate)));
            setLoading(false);
          }
        } catch {
          if (active) setLoading(false);
          return;
        }
        try {
          const fresh = await diaryService.getDiary(userId);
          if (active) {
            setEntries([...fresh].sort((a, b) => b.entryDate.localeCompare(a.entryDate)));
            setError(null);
          }
        } catch (e) {
          if (active) setError(getErrorMessage(e));
        }
      })();

      return () => { active = false; };
    }, [userId]),
  );

  const confirmDelete = (entry: DiaryEntry) => {
    Alert.alert('Delete Entry', `"${entry.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          diaryService.deleteEntry(userId, entry.id)
            .then(() => setEntries((prev) => prev.filter((e) => e.id !== entry.id)))
            .catch((e) => setError(getErrorMessage(e)));
        },
      },
    ]);
  };

  if (loading) {
    return (
      <AppShell title="My Diary">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.accent} />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell title="My Diary">
      <View style={styles.flex}>
      <FlatList
        contentContainerStyle={styles.container}
        data={entries}
        keyExtractor={(e) => e.id}
        ListEmptyComponent={
          error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <EmptyState icon="📖" message="Your diary is empty. Write your first entry!" />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
            onPress={() => navigation.navigate('PreviewDiary', { entry: item })}>
            <Text style={styles.mood}>{MOODS[item.mood?.toUpperCase()] ?? '📔'}</Text>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.date}>{(item.entryDate ?? '').slice(0, 10)}</Text>
              </View>
              <Text style={styles.content} numberOfLines={2}>
                {item.content}
              </Text>
              <View style={styles.actions}>
                <Pressable onPress={() => navigation.navigate('EditDiary', { entry: item })} hitSlop={6}>
                  <Text style={styles.action}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => confirmDelete(item)} hitSlop={6}>
                  <Text style={[styles.action, { color: t.danger }]}>Delete</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        )}
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('NewDiaryEntry')}>
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>
      </View>
    </AppShell>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.lg, paddingBottom: 80, flexGrow: 1 },
  card: {
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
  },
  mood: { fontSize: 26 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontWeight: '700', fontSize: 16, color: t.text },
  date: { fontSize: 12, color: t.textSecondary, marginLeft: spacing.sm },
  content: { color: t.textSecondary, marginTop: spacing.xs, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm + 2 },
  action: { color: t.accent, fontWeight: '600', fontSize: 13 },
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
} as const);
