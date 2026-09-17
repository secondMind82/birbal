import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppShell from '../components/AppShell';
import { getErrorMessage } from '../api/client';
import { EmptyState } from '../components/ui';
import type { Entity } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as entitiesService from '../services/entitiesService';
import { colors, radii, spacing } from '../theme';

type Nav = NativeStackNavigationProp<import('../navigation/types').RootStackParamList>;

const TYPE_ICONS: Record<string, string> = {
  PERSON: '👤',
  COMPANY: '🏢',
  PLACE: '📍',
  ORGANIZATION: '🏢',
  EVENT: '📅',
  COURSE: '🎓',
  TECHNOLOGY: '💻',
};

export default function EntitiesScreen() {
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore((s) => s.user?.id);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) {
        setLoading(false);
        setError('User is not authenticated');
        return () => {
          active = false;
        };
      }

      let hadCached = false;

      (async () => {
        try {
          const cached = await entitiesService.getCachedEntities(userId);
          hadCached = cached.length > 0;
          if (active) {
            setEntities(cached);
            setLoading(false);
          }
        } catch {
          if (active) setLoading(false);
          return;
        }

        try {
          const fresh = await entitiesService.getEntities(userId);
          if (active) {
            setEntities(fresh);
            setError(null);
          }
        } catch (e) {
          if (active && !hadCached) {
            setError(getErrorMessage(e));
          }
        }
      })();

      return () => {
        active = false;
      };
    }, [userId]),
  );

  const peopleCount = useMemo(
    () => entities.filter((e) => e.type.toUpperCase().includes('PERSON')).length,
    [entities],
  );
  const companiesCount = useMemo(
    () => entities.filter((e) => e.type.toUpperCase().includes('COMPANY') || e.type.toUpperCase().includes('ORGANIZATION')).length,
    [entities],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q),
    );
  }, [entities, search]);

  const confirmDelete = (entity: Entity) => {
    Alert.alert('Delete Entity', `"${entity.name}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          entitiesService.deleteEntity(userId, entity.id)
            .then(() => setEntities((prev) => prev.filter((e) => e.id !== entity.id)))
            .catch((e) => setError(getErrorMessage(e)));
        },
      },
    ]);
  };

  if (loading) {
    return (
      <AppShell title="Entities">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell title="Entities">
      <View style={styles.flex}>
        <FlatList
          contentContainerStyle={styles.container}
          data={filtered}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={
            <>
              <Text style={styles.pageTitle}>Your People & Places</Text>
              <Text style={styles.pageSubtitle}>Everyone and everything you know</Text>
              {entities.length > 0 && (
                <View style={styles.statsRow}>
                  <StatCard label="People" value={peopleCount} />
                  <StatCard label="Companies" value={companiesCount} />
                  <StatCard label="Total" value={entities.length} />
                </View>
              )}
              {entities.length > 0 && (
                <TextInput
                  style={styles.search}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search person or company..."
                  placeholderTextColor={colors.textSecondary}
                />
              )}
            </>
          }
          ListEmptyComponent={
            error ? (
              <Text style={styles.error}>{error}</Text>
            ) : entities.length === 0 ? (
              <EmptyState icon="👥" message="No entities yet. Tap + to add people, places and more." />
            ) : (
              <Text style={styles.noResults}>No results for "{search}"</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
              onPress={() => navigation.navigate('PreviewEntity', { entity: item })}>
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: '#EEF2FF' },
                ]}>
                <Text style={{ fontSize: 20 }}>{TYPE_ICONS[item.type] ?? '👤'}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.type}>{item.type}</Text>
                {item.description ? (
                  <Text style={styles.desc} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => confirmDelete(item)} hitSlop={8}>
                <Text style={styles.delete}>🗑️</Text>
              </Pressable>
            </Pressable>
          )}
        />
        <Pressable style={styles.fab} onPress={() => navigation.navigate('NewEntity')}>
          <Text style={styles.fabIcon}>+</Text>
        </Pressable>
      </View>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.lg, paddingBottom: 80, flexGrow: 1 },
  pageTitle: { fontSize: 22, fontWeight: '800', color: colors.text },
  pageSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.accent },
  statLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  search: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardBody: { flex: 1 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontWeight: '700', fontSize: 16, color: colors.text },
  type: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 2,
    borderRadius: radii.full,
    overflow: 'hidden',
    marginTop: 4,
  },
  desc: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  delete: { fontSize: 16, padding: 4 },
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
  noResults: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.xl },
  error: { color: colors.danger, textAlign: 'center', marginTop: spacing.xl },
});
