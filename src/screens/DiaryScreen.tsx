import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppShell from '../components/AppShell';
import { deleteDiaryEntry, getDiaryEntries } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import { EmptyState } from '../components/ui';
import type { DiaryEntry } from '../models/types';
import { colors, radii, spacing } from '../theme';

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
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      getDiaryEntries()
        .then((list) =>
          active &&
          setEntries([...list].sort((a, b) => b.entryDate.localeCompare(a.entryDate))))
        .catch((e) => active && setError(getErrorMessage(e)))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, []),
  );

  const confirmDelete = (entry: DiaryEntry) => {
    Alert.alert('Delete Entry', `"${entry.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteDiaryEntry(entry.id)
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
          <ActivityIndicator size="large" color={colors.accent} />
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
                  <Text style={[styles.action, { color: colors.danger }]}>Delete</Text>
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.lg, paddingBottom: 80, flexGrow: 1 },
  card: {
    backgroundColor: '#fff',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
  },
  mood: { fontSize: 26 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontWeight: '700', fontSize: 16, color: colors.text },
  date: { fontSize: 12, color: colors.textSecondary, marginLeft: spacing.sm },
  content: { color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm + 2 },
  action: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabIcon: { color: '#fff', fontSize: 28, marginTop: -2 },
  error: { color: colors.danger, textAlign: 'center', marginTop: spacing.xl },
});
