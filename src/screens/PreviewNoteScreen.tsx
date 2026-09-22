import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../components/ui';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/authStore';
import * as notesService from '../services/notesService';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PreviewNote'>;
type IconName = ComponentProps<typeof Ionicons>['name'];

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PreviewNoteScreen({ route, navigation }: Props) {
  const { note } = route.params;
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const userId = useAuthStore((s) => s.user?.id);

  const confirmDelete = () => {
    Alert.alert('Delete Note', `"${note.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          notesService.deleteNote(userId, note.id)
            .then(() => navigation.popToTop())
            .catch((e) => Alert.alert('Error', getErrorMessage(e)));
        },
      },
    ]);
  };

  const createdLabel = formatDateTime(note.createdAt);
  const updatedLabel = formatDateTime(note.updatedAt);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <View style={styles.heroBadgeInner}>
            <Ionicons name="document-text-outline" size={28} color={t.accent} />
          </View>
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{note.title}</Text>
          {note.pinned ? <Text style={{ fontSize: 20 }}>📌</Text> : null}
        </View>
        {createdLabel ? (
          <Text style={styles.heroMeta}>{createdLabel}</Text>
        ) : null}
      </View>

      <View style={styles.contentCard}>
        <Text style={styles.sectionLabel}>Content</Text>
        <Text style={styles.content}>{note.content}</Text>
      </View>

      <View style={styles.contentCard}>
        <Text style={styles.sectionLabel}>Details</Text>
        {createdLabel ? (
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={16} color={t.textSecondary} />
            <Text style={styles.metaLabel}>Created</Text>
            <Text style={styles.metaValue}>{createdLabel}</Text>
          </View>
        ) : null}
        {updatedLabel ? (
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={16} color={t.textSecondary} />
            <Text style={styles.metaLabel}>Last updated</Text>
            <Text style={styles.metaValue}>{updatedLabel}</Text>
          </View>
        ) : null}
      </View>

      <Button title="Edit Note" onPress={() => navigation.navigate('EditNote', { note })} />
      <Button title="Delete Note" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  heroCard: {
    backgroundColor: t.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    padding: spacing.xl,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  heroBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroBadgeInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexShrink: 1, fontSize: 22, fontWeight: '800', color: t.text, textAlign: 'center' },
  heroMeta: { fontSize: 12, color: t.textSecondary, marginTop: spacing.xs },
  contentCard: {
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  content: { fontSize: 15, lineHeight: 26, color: t.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  metaLabel: { flex: 1, fontSize: 13, color: t.textSecondary, paddingLeft: spacing.sm },
  metaValue: { fontSize: 15, fontWeight: '600', color: t.text },
} as const);