import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FontAwesome } from '@expo/vector-icons';
import { Button, ErrorText, Input } from '../../components/ui';
import type { RootStackParamList } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { signOutFromGoogle } from '../../services/socialAuth';
import { radii, spacing, useAppStyles, useAppTheme } from '../../theme';
import type { BirbalTheme } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const login = useAuthStore((s) => s.login);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const loginWithApple = useAuthStore((s) => s.loginWithApple);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);

  useEffect(() => {
    void signOutFromGoogle();
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);

  const handleLogin = async () => {
    const ok = await login(email.trim(), password);
    if (!ok) return;
    navigation.replace('Main');
  };

  const handleGoogleLogin = async () => {
    const ok = await loginWithGoogle();
    if (!ok) return;
    navigation.replace('Main');
  };

  const handleAppleLogin = async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Apple Sign-In', 'Apple Sign-In sirf iOS pe available hai.');
      return;
    }
    const ok = await loginWithApple();
    if (!ok) return;
    navigation.replace('Main');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Image source={require('../../../assets/auth-logo.png')} style={styles.logo} resizeMode="contain" />

        <View style={styles.card}>
          <Text style={styles.title}>Welcome Back 👋</Text>
          <Text style={styles.subtitle}>Login to continue your productivity journey.</Text>

          <Input
            label="Email Address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <View>
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!passwordVisible}
              right={
                <Pressable onPress={() => setPasswordVisible(!passwordVisible)} hitSlop={8}>
                  <Text style={styles.show}>{passwordVisible ? 'Hide' : 'Show'}</Text>
                </Pressable>
              }
            />
          </View>

          <ErrorText error={error} />

          <Button
            title="Login"
            onPress={() => void handleLogin()}
            loading={isLoading}
            disabled={!email.trim() || !password}
            style={{ marginTop: spacing.md }}
          />

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={styles.socialButton}
            onPress={() => void handleGoogleLogin()}>
            <FontAwesome name="google" size={20} color="#DB4437" />
            <Text style={styles.socialButtonText}>Continue with Google</Text>
          </Pressable>

          <Pressable
            style={styles.socialButton}
            onPress={() => void handleAppleLogin()}>
            <FontAwesome name="apple" size={22} color="#1A1A1A" />
            <Text style={[styles.socialButtonText, { color: t.text }]}>
              Continue with Apple
            </Text>
          </Pressable>

          <View style={styles.row}>
            <Text style={styles.rowText}>Don't have an account? </Text>
            <Pressable onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.link}>Sign Up</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: t.background,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 12,
    alignSelf: 'center',
    marginBottom: spacing.xxl,
  },
  card: {
    backgroundColor: t.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: { color: t.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    color: t.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  show: { color: t.accent, fontWeight: '600', fontSize: 13 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: t.border,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    fontSize: 13,
    fontWeight: '600',
    color: t.textSecondary,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: t.text,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  rowText: { color: t.text, fontSize: 14 },
  link: { color: t.accent, fontWeight: '700', fontSize: 14 },
} as const);
