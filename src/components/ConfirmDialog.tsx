import React, { useRef } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { radii, shadows, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

export type ConfirmTone = 'success' | 'danger';

export interface ConfirmDialogProps {
  /** Big glyph inside the circular badge, e.g. "✓" or "✕". */
  icon: string;
  title: string;
  message: string;
  /** Label for the affirmative button, e.g. "Receive" or "Ignore". */
  confirmLabel: string;
  tone: ConfirmTone;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Centered confirmation card over a dimmed backdrop, used before a money
 * action (mark received / ignore) is executed.
 *
 * The backdrop only ever cancels — it can never confirm — and the first
 * interaction wins, so the affirmative action fires at most once per open.
 */
export default function ConfirmDialog({
  icon,
  title,
  message,
  confirmLabel,
  tone,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const handledRef = useRef(false);

  const accent = tone === 'danger' ? t.danger : t.success;
  const accentSoft = tone === 'danger' ? t.dangerSoft : t.successSoft;

  const settle = (confirmed: boolean) => {
    if (handledRef.current) return;
    handledRef.current = true;
    if (confirmed) onConfirm();
    else onCancel();
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => settle(false)}>
      <Pressable
        style={styles.backdrop}
        accessibilityLabel="Close confirmation dialog"
        onPress={() => settle(false)}>
        {/* Absorbs taps inside the card so only the backdrop cancels. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={[styles.iconCircle, { backgroundColor: accentSoft }]}>
            <Text style={[styles.iconGlyph, { color: accent }]}>{icon}</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={4}
              style={({ pressed }) => [
                styles.button,
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
              onPress={() => settle(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              hitSlop={4}
              style={({ pressed }) => [
                styles.button,
                styles.confirmButton,
                { backgroundColor: accent },
                pressed && styles.pressed,
              ]}
              onPress={() => settle(true)}>
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  backdrop: {
    flex: 1,
    backgroundColor: t.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: t.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    ...shadows.lg,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  iconGlyph: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  title: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: t.text,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: t.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    alignSelf: 'stretch',
    marginTop: spacing.xl,
  },
  button: {
    flex: 1,
    height: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: { backgroundColor: t.surfaceVariant, borderColor: t.border },
  cancelText: { fontSize: 15, fontWeight: '700', color: t.textSecondary },
  confirmButton: { borderColor: 'transparent' },
  confirmText: { fontSize: 15, fontWeight: '700', color: t.onAccent },
  pressed: { opacity: 0.85 },
}) as const;
