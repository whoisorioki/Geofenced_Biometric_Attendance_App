import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert
} from 'react-native';

export default function LoginScreen({ navigation }) {
  const [studentId, setStudentId] = useState('STU001');

  const handleLogin = () => {
    const normalizedStudentId = String(studentId || '').trim();

    if (!/^STU\d{3,6}$/i.test(normalizedStudentId)) {
      Alert.alert('Error', 'Please enter a valid Student ID (e.g. STU001)');
      return;
    }

    navigation.navigate('ClassSelect', { studentId: normalizedStudentId });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>JKUAT Attendance</Text>
      <Text style={styles.subtitle}>Predetermined sessions are loaded automatically</Text>

      <View style={styles.form}>
        <Text style={styles.inputLabel}>Student ID</Text>
        <TextInput
          style={styles.input}
          placeholder="Student ID (STU001)"
          placeholderTextColor="#888888"
          value={studentId}
          onChangeText={setStudentId}
          accessibilityLabel="Student ID input"
          accessibilityHint="Enter your university student ID"
        />

        <TouchableOpacity
          style={styles.button}
          onPress={handleLogin}
          accessibilityLabel="Continue to class selection"
          accessibilityHint="Validates your student ID and opens available sessions"
        >
          <Text style={styles.buttonText}>CONTINUE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080810',
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#00D4FF',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 40,
  },
  form: {
    width: '100%',
  },
  inputLabel: {
    color: '#555555',
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#12121e',
    borderColor: '#1e1e2e',
    borderWidth: 1,
    color: '#ffffff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#00D4FF',
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#080810',
    fontSize: 16,
    fontWeight: 'bold',
  },
});