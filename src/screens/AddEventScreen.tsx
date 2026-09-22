import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Chip, ErrorText, FormScreen, Input } from '../components/ui';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import type { Entity, Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as timelinesService from '../services/timelinesService';
import * as entitiesService from '../services/entitiesService';
import { spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Props =
  | NativeStackScreenProps<RootStackParamList, 'AddEvent'>
  | NativeStackScreenProps<RootStackParamList, 'EditTimeline'>;

export default function AddEventScreen(props: Props) {
  const existing: Timeline | undefined = props.route.params?.timeline;
  return <EventForm existing={existing} onDone={() => props.navigation.goBack()} />;
}

function EventForm({ existing, onDone }: { existing?: Timeline; onDone: () => void }) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const userId = useAuthStore((s) => s.user?.id);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [eventDate, setEventDate] = useState(
    (existing?.eventDate ?? new Date().toISOString()).slice(0, 10),
  );
  const [showOnCalendar, setShowOnCalendar] = useState(existing?.showOnCalendar ?? true);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [linkedIds, setLinkedIds] = useState<string[]>(
    existing?.entities?.map((l) => l.entity.id) ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) return () => { active = false; };
      entitiesService.getEntities(userId)
        .then((list) => active && setEntities(list))
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const toggleLink = (id: string) => {
    setLinkedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        description,
        eventDate: `${eventDate}T00:00:00Z`,
        entityIds: linkedIds,
        showOnCalendar,
      };
      if (existing) {
        await timelinesService.updateTimeline(userId, existing.id, body);
      } else {
        await timelinesService.createTimeline(userId, body);
      }
      onDone();
    } catch (e) {
      setError(getErrorMessage(e));
      setLoading(false);
    }
  };

  return (
    <FormScreen>
      <Input label="Event Title" value={title} onChangeText={setTitle} />
      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="What happened?"
      />
      <Input
        label="Event Date (YYYY-MM-DD)"
        value={eventDate}
        onChangeText={setEventDate}
        autoCapitalize="none"
      />

      {entities.length > 0 && (
        <>
          <Text style={styles.label}>Link Entities</Text>
          <View style={styles.chipsRow}>
            {entities.map((e) => (
              <Pressable key={e.id} onPress={() => toggleLink(e.id)}>
                <View style={{ opacity: linkedIds.includes(e.id) ? 1 : 0.45 }}>
                  <Chip
                    text={`@${e.name}`}
                    color={linkedIds.includes(e.id) ? t.accent : t.textSecondary}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <ErrorText error={error} />

      <Button
        title={existing ? 'Update Event' : 'Save Event'}
        onPress={() => void handleSave()}
        loading={loading}
        disabled={!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)}
        style={{ marginTop: spacing.md }}
      />
      <Button title="Cancel" variant="outline" onPress={onDone} />
    </FormScreen>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  label: { fontSize: 13, fontWeight: '600', color: t.text, marginBottom: spacing.sm },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
}) as const;
