import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorText, FormScreen, Input } from '../components/ui';
import { updateEntity } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { colors, radii, spacing } from '../theme';

const TYPES = ['PERSON', 'PLACE', 'ORGANIZATION', 'EVENT'];

type Props = NativeStackScreenProps<RootStackParamList, 'EditEntity'>;

export default function EditEntityScreen({ route, navigation }: Props) {
  const { entity } = route.params;
  const [name, setName] = useState(entity.name);
  const [type, setType] = useState(entity.type);
  const [description, setDescription] = useState(entity.description ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = async () => {
    setLoading(true);
    setError(null);
    try {
      await updateEntity(entity.id, { name: name.trim(), type, description: description.trim() || null });
      navigation.goBack();
    } catch (e) {
      setError(getErrorMessage(e));
      setLoading(false);
    }
  };

  return (
    <FormScreen>
      <Input label="Name" value={name} onChangeText={setName} />

      <Text style={styles.label}>Type</Text>
      <View style={styles.typesRow}>
        {TYPES.map((t) => (
          <TypeChip key={t} label={t} selected={type === t} onPress={() => setType(t)} />
        ))}
      </View>

      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <ErrorText error={error} />

      <Button
        title="Update Entity"
        onPress={() => void handleUpdate()}
        loading={loading}
        disabled={!name.trim()}
        style={{ marginTop: spacing.md }}
      />
      <Button title="Cancel" variant="outline" onPress={() => navigation.goBack()} />
    </FormScreen>
  );
}

function TypeChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.typeChip, selected ? styles.typeChipSelected : styles.typeChipUnselected]}>
      <Text style={[styles.typeChipText, selected && styles.typeChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  typesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  typeChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  typeChipUnselected: { backgroundColor: '#fff', borderColor: colors.border },
  typeChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  typeChipTextSelected: { color: '#fff' },
});
