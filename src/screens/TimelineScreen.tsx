import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppShell from '../components/AppShell';
import { getTimelines } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import { EmptyState } from '../components/ui';
import type { Timeline } from '../models/types';
import { colors, radii, spacing } from '../theme';

type Nav = NativeStackNavigationProp<import('../navigation/types').RootStackParamList>;

export default function TimelineScreen() {
  const navigation = useNavigation<Nav>();
  const [events, setEvents] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      getTimelines()
        .then((list) =>
          active &&
          setEvents([...list].sort((a, b) => b.eventDate.localeCompare(a.eventDate))))
        .catch((e) => active && setError(getErrorMessage(e)))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, []),
  );

  if (loading) {
    return (
      <AppShell title="Timeline">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell title="Timeline">
      <View style={styles.flex}>
      <FlatList
        contentContainerStyle={styles.container}
        data={events}
        keyExtractor={(e) => e.id}
        ListEmptyComponent={
          error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <EmptyState icon="📅" message="No events yet. Tap + to add one." />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
            onPress={() => navigation.navigate('PreviewTimeline', { timeline: item })}>
            <View style={styles.dateBox}>
              <Text style={styles.dateDay}>{(item.eventDate ?? '').slice(8, 10)}</Text>
              <Text style={styles.dateMonth}>{monthShort(item.eventDate)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.description} numberOfLines={1}>
                {item.description}
              </Text>
              {item.entities && item.entities.length > 0 && (
                <View style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {item.entities.map((l) => `@${l.entity.name}`).join(' ')}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        )}
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('AddEvent')}>
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>
      </View>
    </AppShell>
  );
}

function monthShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en', { month: 'short' }).toUpperCase();
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
    padding: spacing.md + 2,
    marginBottom: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
  },
  dateBox: {
    width: 52,
    height: 56,
    borderRadius: radii.sm,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDay: { fontSize: 20, fontWeight: '800', color: colors.accent },
  dateMonth: { fontSize: 11, fontWeight: '700', color: colors.accent },
  title: { fontWeight: '700', fontSize: 15, color: colors.text },
  description: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 6,
  },
  chipText: { fontSize: 11, color: colors.accent, fontWeight: '700' },
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
