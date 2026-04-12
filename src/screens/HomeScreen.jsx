import React, { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert
} from 'react-native';
import { executeSQL } from '../services/snowflake.service';

export default function HomeScreen({ route, navigation }) {
  const studentId = route?.params?.studentId;

  useEffect(() => {
    if (!studentId) {
      Alert.alert(
        'Session Expired',
        'Please log in again to continue.',
        [{ text: 'Go to Login', onPress: () => navigation.replace('Login') }]
      );
    }
  }, [studentId]);

  // Warm up the Snowflake warehouse in the background so ClassSelectScreen
  // loads faster — the warehouse is already running by the time the user taps.
  useEffect(() => {
    executeSQL('SELECT 1', {}).catch(() => { /* silent — this is just a warm-up ping */ });
  }, []);

  const navigateToCheckIn = () => {
    navigation.navigate('ClassSelect', { studentId });
  };

  const navigateToHistory = () => {
    navigation.navigate('History', { studentId });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, {studentId}</Text>
      <Text style={styles.subtitle}>Session-based attendance with dynamic classroom mapping</Text>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={navigateToCheckIn}
          accessibilityLabel="Mark attendance"
          accessibilityHint="Opens class session selection before check-in"
        >
          <Text style={styles.primaryButtonText}>📍 MARK ATTENDANCE</Text>
          <Text style={styles.buttonDescription}>Check in with GPS and biometrics</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={navigateToHistory}
          accessibilityLabel="View attendance history"
          accessibilityHint="Shows recent attendance records"
        >
          <Text style={styles.secondaryButtonText}>📊 VIEW HISTORY</Text>
          <Text style={styles.buttonDescription}>See your attendance records</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>How it works:</Text>
        <Text style={styles.infoText}>• Verify your identity with biometrics</Text>
        <Text style={styles.infoText}>• GPS confirms you're in the classroom</Text>
        <Text style={styles.infoText}>• Device fingerprinting prevents proxy attendance</Text>
        <Text style={styles.infoText}>• Real-time sync with Snowflake database</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080810',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#00D4FF',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 40,
  },
  buttonContainer: {
    flex: 1,
    justifyContent: 'center',
    gap: 20,
  },
  primaryButton: {
    backgroundColor: '#00D4FF',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#080810',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  secondaryButton: {
    backgroundColor: '#12121e',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e1e2e',
  },
  secondaryButtonText: {
    color: '#00D4FF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  buttonDescription: {
    color: '#555555',
    fontSize: 12,
  },
  infoBox: {
    backgroundColor: '#12121e',
    borderWidth: 1,
    borderColor: '#1e1e2e',
    padding: 20,
    borderRadius: 12,
    marginTop: 20,
  },
  infoTitle: {
    color: '#00D4FF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  infoText: {
    color: '#ffffff',
    fontSize: 14,
    marginBottom: 6,
  },
});