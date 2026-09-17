import 'react-native-gesture-handler';
import React, { Component, useEffect, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { initializeDatabase } from './src/db/database';
import { useAuthStore } from './src/store/authStore';

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.boundary}>
          <Text style={styles.boundaryTitle}>Error:</Text>
          <ScrollView style={styles.boundaryScroll}>
            <Text style={styles.boundaryMsg}>
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const restore = useAuthStore((s) => s.restore);

  useEffect(() => {
    void initializeDatabase().catch(() => {
      // Database init is fail-safe: leave it to lazy getDb() to retry when a
      // domain repository first needs it. Never block or change auth restore.
    });
    void restore();
  }, [restore]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <AppNavigator />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  boundary: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 80 },
  boundaryTitle: { fontSize: 20, fontWeight: '700', color: '#DC2626', marginBottom: 12 },
  boundaryScroll: { flex: 1 },
  boundaryMsg: { color: '#111', fontSize: 13, lineHeight: 20 },
});
