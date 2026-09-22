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
import type { Note } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as notesService from '../services/notesService';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Nav = NativeStackNavigationProp<import('../navigation/types').RootStackParamList>;

export default function NotesScreen() {
  const navigation = useNavigation<Nav>();
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const userId = useAuthStore((s) => s.user?.id);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) return () => { active = false; };

      (async () => {
        try {
          const cached = await notesService.getCachedNotes(userId);
          if (active) {
            setNotes(cached);
            setLoading(false);
          }
        } catch {
          if (active) setLoading(false);
          return;
        }
        try {
          const fresh = await notesService.getNotes(userId);
          if (active) {
            setNotes(fresh);
            setError(null);
          }
        } catch (e) {
          // no cached data available, so surface the refresh error
          if (active) setError(getErrorMessage(e));
        }
      })();

      return () => { active = false; };
    }, [userId]),
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    );
  }, [notes, search]);

  const pinned = useMemo(() => filtered.filter((n) => n.pinned), [filtered]);
  const others = useMemo(() => filtered.filter((n) => !n.pinned), [filtered]);

  const togglePin = async (note: Note) => {
    setMenuFor(null);
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)),
    );
    try {
      const updated = await notesService.togglePin(userId, note);
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n)),
      );
    } catch (e) {
      setError(getErrorMessage(e));
      setNotes((prev) =>
        prev.map((n) => (n.id === note.id ? { ...n, pinned: note.pinned } : n)),
      );
    }
  };

  const confirmDelete = (note: Note) => {
    setMenuFor(null);
    Alert.alert('Delete Note', `"${note.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          notesService.deleteNote(userId, note.id)
            .then(() => setNotes((prev) => prev.filter((n) => n.id !== note.id)))
            .catch((e) => setError(getErrorMessage(e)));
        },
      },
    ]);
  };

  if (loading) {
    return (
      <AppShell title="Notes">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.accent} />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell title="Notes">
      <View style={styles.flex}>
        <FlatList
          contentContainerStyle={styles.container}
          data={[...pinned, ...others]}
          keyExtractor={(n) => n.id}
          ListHeaderComponent={
            <>
              {notes.length > 0 && (
                <TextInput
                  style={styles.search}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search notes..."
                  placeholderTextColor={t.textSecondary}
                />
              )}
              {pinned.length > 0 && (
                <Text style={styles.sectionLabel}>📌 Pinned ({pinned.length})</Text>
              )}
              {pinned.length > 0 && others.length > 0 && (
                <Text style={styles.sectionLabel}>All Notes</Text>
              )}
            </>
          }
          ListEmptyComponent={
            error ? (
              <Text style={styles.error}>{error}</Text>
            ) : notes.length === 0 ? (
              <EmptyState icon="📝" message="No notes yet. Tap + to create one!" />
            ) : (
              <Text style={styles.noResults}>No results for "{search}"</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
              onPress={() => navigation.navigate('PreviewNote', { note: item })}>
              <View style={styles.row}>
                {item.pinned ? <Text style={styles.pin}>📌</Text> : null}
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Pressable onPress={() => setMenuFor(menuFor === item.id ? null : item.id)} hitSlop={8}>
                  <Text style={styles.more}>⋮</Text>
                </Pressable>
              </View>
              <Text style={styles.content} numberOfLines={3}>
                {item.content}
              </Text>
              <Text style={styles.date}>Updated: {(item.updatedAt ?? '').slice(0, 10)}</Text>

              {menuFor === item.id && (
                <View style={styles.menu}>
                  <MenuItem
                    label={item.pinned ? 'Unpin Note' : 'Pin Note'}
                    icon="📌"
                    onPress={() => void togglePin(item)}
                  />
                  <MenuItem
                    label="Edit Note"
                    icon="✏️"
                    onPress={() => {
                      setMenuFor(null);
                      navigation.navigate('EditNote', { note: item });
                    }}
                  />
                  <MenuItem
                    label="Delete Note"
                    icon="🗑️"
                    danger
                    onPress={() => confirmDelete(item)}
                  />
                </View>
              )}
            </Pressable>
          )}
        />
        <Pressable style={styles.fab} onPress={() => navigation.navigate('NewNote')}>
          <Text style={styles.fabIcon}>+</Text>
        </Pressable>
      </View>
    </AppShell>
  );
}

function MenuItem({
  label,
  icon,
  onPress,
  danger = false,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  return (
    <Pressable style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.6 }]} onPress={onPress}>
      <Text style={{ fontSize: 13 }}>{icon}</Text>
      <Text style={[styles.menuItemLabel, danger && { color: t.danger }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.lg, paddingBottom: 80, flexGrow: 1 },
  search: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: t.text,
    marginBottom: spacing.md,
  },
  sectionLabel: {
    fontWeight: '700',
    fontSize: 14,
    color: t.textSecondary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pin: { fontSize: 14 },
  title: { flex: 1, fontWeight: '700', fontSize: 16, color: t.text },
  more: { fontSize: 20, fontWeight: '700', color: t.textSecondary, paddingHorizontal: 4 },
  content: { color: t.textSecondary, marginTop: spacing.xs, lineHeight: 20 },
  date: { fontSize: 12, color: t.textSecondary, marginTop: spacing.sm + 2 },
  menu: {
    position: 'absolute',
    top: 40,
    right: spacing.lg,
    backgroundColor: t.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: t.border,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    minWidth: 150,
    zIndex: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.border,
  },
  menuItemLabel: { fontSize: 14, fontWeight: '600', color: t.text },
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
  noResults: { textAlign: 'center', color: t.textSecondary, marginTop: spacing.xl },
  error: { color: t.danger, textAlign: 'center', marginTop: spacing.xl },
} as const);
