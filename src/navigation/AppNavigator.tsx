import React, { useMemo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme as NavDefaultTheme, DarkTheme as NavDarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';

import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ExpensesScreen from '../screens/ExpensesScreen';
import TimelineScreen from '../screens/TimelineScreen';
import CalendarScreen from '../screens/CalendarScreen';
import EntitiesScreen from '../screens/EntitiesScreen';
import NotesScreen from '../screens/NotesScreen';
import DiaryScreen from '../screens/DiaryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AddExpenseScreen from '../screens/AddExpenseScreen';
import AddEventScreen from '../screens/AddEventScreen';
import CreateNoteScreen from '../screens/CreateNoteScreen';
import CreateEntityScreen from '../screens/CreateEntityScreen';
import EditNoteScreen from '../screens/EditNoteScreen';
import EditEntityScreen from '../screens/EditEntityScreen';
import EditDiaryScreen from '../screens/EditDiaryScreen';
import PreviewNoteScreen from '../screens/PreviewNoteScreen';
import PreviewEntityScreen from '../screens/PreviewEntityScreen';
import PreviewTimelineScreen from '../screens/PreviewTimelineScreen';
import PreviewDiaryScreen from '../screens/PreviewDiaryScreen';
import DrawerContent from '../components/DrawerContent';
import { useAuthStore } from '../store/authStore';
import { darkColors, useAppTheme } from '../theme';
import { navigationRef } from './navigationRef';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator();

function MainDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        drawerStyle: { width: 280, backgroundColor: 'transparent' },
        overlayColor: 'rgba(0,0,0,0.5)',
      }}>
      <Drawer.Screen name="Dashboard" component={DashboardScreen} />
      <Drawer.Screen name="Expenses" component={ExpensesScreen} />
      <Drawer.Screen name="Timeline" component={TimelineScreen} />
      <Drawer.Screen name="Calendar" component={CalendarScreen} />
      <Drawer.Screen name="Entities" component={EntitiesScreen} />
      <Drawer.Screen name="Notes" component={NotesScreen} />
      <Drawer.Screen name="Diary" component={DiaryScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
    </Drawer.Navigator>
  );
}

export default function AppNavigator() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const restoring = useAuthStore((s) => s.restoring);
  const theme = useAppTheme();

  const screenOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: theme.sidebarStart },
      headerTintColor: '#fff',
      headerTitleStyle: { fontWeight: '800' as const, letterSpacing: -0.2 },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: theme.background },
    }),
    [theme],
  );

  const navTheme = useMemo(() => {
    const isDark = theme === darkColors;
    const base = isDark ? NavDarkTheme : NavDefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        background: theme.background,
        card: theme.sidebarStart,
        text: '#fff',
        border: theme.border,
        primary: theme.accent,
        notification: theme.danger,
      },
    };
  }, [theme]);

  if (restoring) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={{ marginTop: 12, color: theme.textSecondary, fontWeight: '700', letterSpacing: 0.4 }}>Birbal</Text>
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator screenOptions={screenOptions}>
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
          </>
        ) : (
          <>
              <Stack.Screen
              name="Main"
              component={MainDrawer}
              options={{ headerShown: false }}
            />
            <Stack.Screen name="NewNote" component={CreateNoteScreen} options={{ title: 'New Note' }} />
            <Stack.Screen name="NewEntity" component={CreateEntityScreen} options={{ title: 'New Entity' }} />
            <Stack.Screen name="AddExpense" component={AddExpenseScreen} options={{ title: 'Add Expense' }} />
            <Stack.Screen name="AddEvent" component={AddEventScreen} options={{ title: 'Add Event' }} />
            <Stack.Screen name="EditTimeline" component={AddEventScreen} options={{ title: 'Edit Timeline' }} />
            <Stack.Screen name="NewDiaryEntry" component={EditDiaryScreen} options={{ title: 'New Entry' }} />

            <Stack.Screen name="EditNote" component={EditNoteScreen} options={{ title: 'Edit Note' }} />
            <Stack.Screen name="EditEntity" component={EditEntityScreen} options={{ title: 'Edit Entity' }} />
            <Stack.Screen name="EditDiary" component={EditDiaryScreen} options={{ title: 'Edit Diary' }} />

            <Stack.Screen name="PreviewNote" component={PreviewNoteScreen} options={{ title: 'Note' }} />
            <Stack.Screen name="PreviewEntity" component={PreviewEntityScreen} options={{ title: 'Entity' }} />
            <Stack.Screen name="PreviewTimeline" component={PreviewTimelineScreen} options={{ title: 'Event' }} />
            <Stack.Screen name="PreviewDiary" component={PreviewDiaryScreen} options={{ title: 'Entry' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
