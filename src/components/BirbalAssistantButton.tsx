import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { shadows, spacing, useAppTheme } from '../theme';

/**
 * Small floating Birbal robot entry point for the AI Assistant.
 *
 * Purely presentational: the parent decides what to open, so this component
 * never touches navigation, data, or any existing Dashboard logic.
 */
export default function BirbalAssistantButton({ onPress }: { onPress: () => void }) {
  const t = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Birbal assistant"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <LinearGradient
        colors={t.gradient.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}>
        <MaterialCommunityIcons name="robot" size={26} color="#FFFFFF" />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    borderRadius: 26,
    ...shadows.md,
  },
  gradient: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
});
