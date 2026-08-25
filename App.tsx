import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { useAuthStore } from './src/store/authStore';

export default function App() {
  const restore = useAuthStore((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
