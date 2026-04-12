import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';
import { getDeviceHash } from '../services/device.service';
import { executeSQL } from '../services/snowflake.service';

const CHECKIN_SQL = `
  INSERT INTO ATTENDANCE_DB.CORE.FACT_ATTENDANCE (
    ATTENDANCE_ID, STUDENT_ID, CLASS_ID, COURSE_ID,
    STATUS, DEVICE_LOCATION, DEVICE_HASH, IP_ADDRESS
  )
  SELECT
    UUID_STRING(),
    ?,                                    -- 1: studentId
    ?,                                    -- 2: classId
    ?,                                    -- 3: courseId
    CASE
      WHEN (
        SELECT ENROLLED_DEVICE_HASH
        FROM ATTENDANCE_DB.CORE.DIM_STUDENT
        WHERE STUDENT_ID = ?              -- 4: studentId
      ) != ?                              -- 5: deviceHash
        THEN 'PROXY-BLOCKED'

      WHEN NOT EXISTS (
        SELECT 1
        FROM ATTENDANCE_DB.CORE.DIM_COURSE
        WHERE COURSE_ID = ?               -- 6: courseId
          AND UPPER(DAY_OF_WEEK) =
              CASE DAYOFWEEKISO(CURRENT_DATE())
                WHEN 1 THEN 'MONDAY'
                WHEN 2 THEN 'TUESDAY'
                WHEN 3 THEN 'WEDNESDAY'
                WHEN 4 THEN 'THURSDAY'
                WHEN 5 THEN 'FRIDAY'
                WHEN 6 THEN 'SATURDAY'
                WHEN 7 THEN 'SUNDAY'
              END
          AND CURRENT_TIME() BETWEEN
                TO_TIME(START_TIME, 'HH24:MI') AND TO_TIME(END_TIME, 'HH24:MI')
      )
        THEN 'WRONG-TIME-OR-DAY'

      WHEN ST_DWITHIN(
        ST_MAKEPOINT(?, ?),               -- 7: lon, 8: lat
        (SELECT GEOFENCE_POLYGON
         FROM ATTENDANCE_DB.CORE.DIM_CLASSROOM
         WHERE CLASS_ID = ?),             -- 9: classId
        50
      )
        THEN 'PRESENT'

      ELSE 'ABSENT-OUT-OF-BOUNDS'
    END,
    ST_MAKEPOINT(?, ?),                   -- 10: lon, 11: lat
    ?,                                    -- 12: deviceHash
    'N/A'
  WHERE EXISTS (
    SELECT 1 FROM ATTENDANCE_DB.CORE.DIM_STUDENT
    WHERE STUDENT_ID = ? AND IS_ACTIVE = TRUE  -- 13: studentId
  )
`;

const LAST_ATTENDANCE_STATUS_SQL = `
  SELECT STATUS
  FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE
  WHERE STUDENT_ID = ?
    AND COURSE_ID = ?
  ORDER BY CHECK_IN_TIME DESC
  LIMIT 1
`;

const REGISTER_STUDENT_SQL = `
  INSERT INTO ATTENDANCE_DB.CORE.DIM_STUDENT (
    STUDENT_ID, FIRST_NAME, LAST_NAME, EMAIL, ENROLLED_DEVICE_HASH, IS_ACTIVE
  )
  SELECT ?, ?, ?, ?, ?, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM ATTENDANCE_DB.CORE.DIM_STUDENT WHERE STUDENT_ID = ?
  )
`;

const GEOFENCE_STATUS_SQL = `
  SELECT IFF(
    ST_DWITHIN(
      ST_MAKEPOINT(?, ?),
      (SELECT GEOFENCE_POLYGON
       FROM ATTENDANCE_DB.CORE.DIM_CLASSROOM
       WHERE CLASS_ID = ?),
      50
    ),
    TRUE,
    FALSE
  ) AS IS_INSIDE
`;

const withTimeout = (promise, timeoutMs, timeoutMessage) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
};

export default function MarkAttendanceScreen({ route, navigation }) {
  const params = route?.params || {};
  const {
    studentId,
    courseId,
    selectedClassId,
    selectedBuildingName,
    selectedCourseTitle,
  } = params;

  const [liveLocation, setLiveLocation]                   = useState(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [deviceHash, setDeviceHash]                       = useState('loading...');
  const [status, setStatus]                               = useState('idle');
  // Separate loading flag so status=idle remains for retry
  const [isSubmitting, setIsSubmitting]                   = useState(false);
  const [proximityState, setProximityState]               = useState('acquiring');
  const [isCheckingGeofence, setIsCheckingGeofence]       = useState(false);
  const [proximityRefreshKey, setProximityRefreshKey]     = useState(0);
  const [perfMetrics, setPerfMetrics]                     = useState(null);
  const [showPerfDebug, setShowPerfDebug]                 = useState(false);

  const locationSub = useRef(null);
  const proximityConfirmed = useRef(false); // once true, never re-check geofence
  const proximityCheckCompleted = useRef(false); // after first check, wait for manual refresh
  const geofenceCheckInFlight = useRef(false);
  const screenActive = useRef(true);

  const resolvedBuildingName = selectedBuildingName ?? 'your classroom';

  // Web browsers use WiFi/IP geolocation (≈50–150 m). Real GPS chipsets achieve ≤20 m.
  // Use a relaxed threshold on web so the button is not permanently disabled.
  const GPS_ACCURACY_THRESHOLD_M = Platform.OS === 'web' ? 150 : 20;

  useEffect(() => {
    if (!studentId || !courseId || !selectedClassId) {
      Alert.alert(
        'Missing Session Details',
        'Please select a class session before marking attendance.',
        [{
          text: 'Back to Classes',
          onPress: () => navigation.replace('ClassSelect', { studentId: studentId || '' }),
        }]
      );
    }
  }, [studentId, courseId, selectedClassId]);

  useEffect(() => {
    getDeviceHash()
      .then(setDeviceHash)
      .catch(() => setDeviceHash('soft-generic-device'));

    startLiveLocation();

    return () => {
      screenActive.current = false;
      if (locationSub.current) {
        locationSub.current.remove();
        locationSub.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const syncProximity = async () => {
      if (locationPermissionDenied) {
        setProximityState('permission-denied');
        return;
      }

      if (!liveLocation) {
        setProximityState('acquiring');
        return;
      }

      // One-shot mode: after the first verification attempt completes,
      // do not auto-run again until the user explicitly refreshes.
      if (proximityCheckCompleted.current) return;

      const accuracy = Number(liveLocation.accuracy || 999);
      if (accuracy > GPS_ACCURACY_THRESHOLD_M) {
        setProximityState('calibrating');
        return;
      }

      // Already confirmed inside — no need to re-query Snowflake on every GPS update.
      // The student is sitting still in class; proximity cannot change.
      if (proximityConfirmed.current) return;

      if (!selectedClassId) {
        setProximityState('unavailable');
        proximityCheckCompleted.current = true;
        return;
      }

      if (geofenceCheckInFlight.current) {
        return;
      }

      geofenceCheckInFlight.current = true;
      setIsCheckingGeofence(true);
      setProximityState('checking');
      try {
        const geofenceResult = await withTimeout(
          executeSQL(GEOFENCE_STATUS_SQL, {
            '1': { type: 'REAL', value: String(liveLocation.longitude) },
            '2': { type: 'REAL', value: String(liveLocation.latitude) },
            '3': { type: 'TEXT', value: selectedClassId },
          }),
          10000,
          'SNOWFLAKE_TIMEOUT'
        );

        if (!screenActive.current) return;

        const insideRaw = geofenceResult?.data?.[0]?.[0];
        const isInside = insideRaw === true || insideRaw === 'TRUE' || insideRaw === 'true' || insideRaw === 1 || insideRaw === '1';
        proximityCheckCompleted.current = true;

        if (isInside) {
          proximityConfirmed.current = true;
          setProximityState('inside');
          // Stop the GPS watcher — we have a confirmed fix and the student isn't moving.
          // liveLocation state is already populated so check-in submission still has coords.
          if (locationSub.current) {
            locationSub.current.remove();
            locationSub.current = null;
          }
        } else {
          setProximityState('outside');
        }
      } catch (_) {
        proximityCheckCompleted.current = true;
        if (screenActive.current) {
          setProximityState('unavailable');
        }
      } finally {
        geofenceCheckInFlight.current = false;
        if (screenActive.current) {
          setIsCheckingGeofence(false);
        }
      }
    };

    syncProximity();
  }, [liveLocation, locationPermissionDenied, selectedClassId, proximityRefreshKey]);

  const startLiveLocation = async () => {
    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') {
        setLocationPermissionDenied(true);
        setProximityState('permission-denied');
        return;
      }

      setLocationPermissionDenied(false);

      // 1. Instant cache hit — populates UI immediately with no waiting
      try {
        const last = await Location.getLastKnownPositionAsync({});
        if (last?.coords) {
          setLiveLocation({
            latitude:  last.coords.latitude,
            longitude: last.coords.longitude,
            accuracy:  last.coords.accuracy ?? 999,
          });
        }
      } catch (_) { /* no cached fix available, that's fine */ }

      // 2. Start the continuous watcher immediately — do NOT await the first fix first.
      //    The watcher fires on every update so it will progressively improve accuracy.
      const sub = await Location.watchPositionAsync(
        {
          accuracy:         Location.Accuracy.High,
          timeInterval:     2000,
          distanceInterval: 0,
        },
        (position) => {
          setLiveLocation({
            latitude:  position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy:  position.coords.accuracy ?? 999,
          });
        }
      );
      locationSub.current = sub;

      // 3. Race a single fresh fix against a short timeout in the background.
      //    This improves accuracy faster than waiting for the watcher alone,
      //    but never blocks the watcher from starting.
      (async () => {
        try {
          const snap = await withTimeout(
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            6000,
            'SNAP_TIMEOUT'
          );
          if (snap?.coords) {
            setLiveLocation({
              latitude:  snap.coords.latitude,
              longitude: snap.coords.longitude,
              accuracy:  snap.coords.accuracy ?? 999,
            });
          }
        } catch (_) { /* timed out or failed — watcher will cover it */ }
      })();

    } catch (error) {
      console.warn('Live location failed:', error.message);
    }
  };

  const getCurrentPositionWithTimeout = async () => {
    const snapshot = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      15000,
      'GPS_TIMEOUT'
    );

    return {
      latitude: snapshot.coords.latitude,
      longitude: snapshot.coords.longitude,
      accuracy: snapshot.coords.accuracy,
    };
  };

  const handleRefreshProximity = () => {
    if (geofenceCheckInFlight.current) return;

    proximityConfirmed.current = false;
    proximityCheckCompleted.current = false;

    if (locationPermissionDenied) {
      setProximityState('permission-denied');
    } else if (!liveLocation) {
      setProximityState('acquiring');
    } else if (Number(liveLocation.accuracy || 999) > GPS_ACCURACY_THRESHOLD_M) {
      setProximityState('calibrating');
    } else {
      setProximityState('checking');
    }

    setProximityRefreshKey((prev) => prev + 1);
  };

  const handleCheckIn = async () => {
    // Prevent double-tap
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatus('idle');
    setPerfMetrics(null);

    const flowStartAt = Date.now();
    let biometricPromptAt = flowStartAt;
    let biometricSuccessAt = flowStartAt;
    let gpsStartAt = flowStartAt;
    let gpsCompleteAt = flowStartAt;
    let snowflakeRequestAt = flowStartAt;
    let snowflakeResponseAt = flowStartAt;

    try {
      // ── STEP 1: Biometric ──────────────────────────────────────────
      setStatus('biometric');

      if (Platform.OS !== 'web') {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = hasHardware ? await LocalAuthentication.isEnrolledAsync() : false;

        if (!hasHardware || !isEnrolled) {
          setIsSubmitting(false);
          setStatus('idle');
          Alert.alert(
            'Biometric Unavailable',
            'Biometric hardware is not available or not enrolled on this device. Set up fingerprint/face unlock and try again.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retry', onPress: handleCheckIn },
            ]
          );
          return;
        }

        let bioResult;
        try {
          biometricPromptAt = Date.now();
          bioResult = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Confirm your identity to mark attendance for this class session',
            fallbackLabel: 'Use PIN',
            cancelLabel:   'Cancel',
            disableDeviceFallback: false,
          });
        } catch (bioError) {
          // Biometric module error (not user cancellation) — allow fallback
          console.warn('Biometric error:', bioError.message);
          bioResult = { success: false, error: bioError.message };
        }

        if (!bioResult.success) {
          // Don't throw — show alert and return cleanly without crashing
          setIsSubmitting(false);
          setStatus('idle');
          const cancelledByUser = bioResult.error === 'UserCancel' || bioResult.error === 'user_cancel';
          Alert.alert(
            cancelledByUser ? 'Authentication Cancelled' : 'Authentication Failed',
            cancelledByUser
              ? 'You cancelled biometric verification. Retry when you are ready.'
              : 'Biometric verification failed. Please try again.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retry', onPress: handleCheckIn },
            ]
          );
          return; // ← clean return, no throw, no crash
        }

        biometricSuccessAt = Date.now();
      } else {
        biometricPromptAt = flowStartAt;
        biometricSuccessAt = Date.now();
      }

      // ── STEP 2: GPS check ──────────────────────────────────────────
      setStatus('gps');
      gpsStartAt = Date.now();

      if (locationPermissionDenied) {
        setIsSubmitting(false);
        setStatus('idle');
        Alert.alert(
          'Location Required',
          'Enable location access in device Settings, then return to this screen.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: startLiveLocation },
          ]
        );
        return;
      }

      let location = liveLocation;

      // If watch hasn't delivered yet, try one more snapshot
      if (!location) {
        try {
          location = await getCurrentPositionWithTimeout();
          setLiveLocation(location);
        } catch (gpsError) {
          setIsSubmitting(false);
          setStatus('idle');
          Alert.alert(
            gpsError.message === 'GPS_TIMEOUT' ? 'GPS Timeout' : 'GPS Unavailable',
            gpsError.message === 'GPS_TIMEOUT'
              ? 'GPS signal could not be obtained. Please try again.'
              : 'Could not read your location. Please try again.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retry', onPress: handleCheckIn },
            ]
          );
          return;
        }
      }
      gpsCompleteAt = Date.now();

      // ── STEP 3: Device hash ────────────────────────────────────────
      setStatus('submitting');

      const hash = deviceHash === 'loading...' ? await getDeviceHash() : deviceHash;
      if (!hash || hash === 'unknown-device') {
        setIsSubmitting(false);
        setStatus('idle');
        Alert.alert(
          'Device Error',
          'Unable to read device ID. Please try again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: handleCheckIn },
          ]
        );
        return;
      }

      const resolvedClassId = selectedClassId ?? 'UNKNOWN';

      // ── STEP 4: Auto-register student ─────────────────────────────
      await withTimeout(executeSQL(REGISTER_STUDENT_SQL, {
        '1': { type: 'TEXT', value: studentId },
        '2': { type: 'TEXT', value: 'Student' },
        '3': { type: 'TEXT', value: studentId },
        '4': { type: 'TEXT', value: `${studentId}@autoreg.local` },
        '5': { type: 'TEXT', value: hash },
        '6': { type: 'TEXT', value: studentId },
      }), 15000, 'SNOWFLAKE_TIMEOUT');

      // ── STEP 5: Submit attendance ──────────────────────────────────
      snowflakeRequestAt = Date.now();
      const result = await withTimeout(executeSQL(CHECKIN_SQL, {
        '1':  { type: 'TEXT', value: studentId },
        '2':  { type: 'TEXT', value: resolvedClassId },
        '3':  { type: 'TEXT', value: courseId },
        '4':  { type: 'TEXT', value: studentId },
        '5':  { type: 'TEXT', value: hash },
        '6':  { type: 'TEXT', value: courseId },
        '7':  { type: 'REAL', value: String(location.longitude) },
        '8':  { type: 'REAL', value: String(location.latitude) },
        '9':  { type: 'TEXT', value: resolvedClassId },
        '10': { type: 'REAL', value: String(location.longitude) },
        '11': { type: 'REAL', value: String(location.latitude) },
        '12': { type: 'TEXT', value: hash },
        '13': { type: 'TEXT', value: studentId },
      }), 15000, 'SNOWFLAKE_TIMEOUT');
      snowflakeResponseAt = Date.now();

      const rowsInserted = result?.stats?.numRowsInserted ?? result?.data?.[0]?.[0];
      if (String(rowsInserted) === '0' || rowsInserted === 0) {
        setIsSubmitting(false);
        setStatus('idle');
        Alert.alert(
          'Not Registered',
          'Your Student ID is not in the system. Contact your lecturer, then retry.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: handleCheckIn },
          ]
        );
        return;
      }

      const lastStatusResult = await withTimeout(executeSQL(LAST_ATTENDANCE_STATUS_SQL, {
        '1': { type: 'TEXT', value: studentId },
        '2': { type: 'TEXT', value: courseId },
      }), 15000, 'SNOWFLAKE_TIMEOUT');
      const lastStatus = lastStatusResult?.data?.[0]?.[0];

      if (lastStatus === 'WRONG-TIME-OR-DAY') {
        setIsSubmitting(false);
        setStatus('idle');
        Alert.alert(
          'Check-In Blocked',
          'This class is not active right now. Check the scheduled day/time and retry.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: handleCheckIn },
          ]
        );
        return;
      }

      if (lastStatus === 'ABSENT-OUT-OF-BOUNDS') {
        setIsSubmitting(false);
        setStatus('idle');
        Alert.alert(
          'Out of Bounds',
          'Your location is outside the classroom boundary. Ensure you are inside the room and retry.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: handleCheckIn },
          ]
        );
        return;
      }

      if (lastStatus === 'PROXY-BLOCKED') {
        setIsSubmitting(false);
        setStatus('idle');
        Alert.alert(
          'Proxy Blocked',
          'Device mismatch detected. Attendance was blocked. Retry on your registered device.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: handleCheckIn },
          ]
        );
        return;
      }

      const metrics = {
        t1: Math.max(0, biometricPromptAt - flowStartAt),
        t2: Math.max(0, gpsStartAt - biometricSuccessAt),
        t3: Math.max(0, snowflakeRequestAt - gpsCompleteAt),
        t4: Math.max(0, snowflakeResponseAt - snowflakeRequestAt),
        t5: Math.max(0, snowflakeResponseAt - flowStartAt),
      };
      setPerfMetrics(metrics);
      setShowPerfDebug(false);
      console.log(
        `[PERF] biometric: ${metrics.t1}ms | gps: ${metrics.t2}ms | snowflake: ${metrics.t4}ms | total: ${metrics.t5}ms`
      );

      // ── SUCCESS ────────────────────────────────────────────────────
      setStatus('done');
      setIsSubmitting(false);
      Alert.alert(
        '✅ Attendance Recorded',
        `Submitted for ${selectedCourseTitle || courseId} at ${resolvedBuildingName}.\n\nYour status has been recorded.`
      );

    } catch (error) {
      // Only truly unexpected errors land here
      console.error('Check-in error:', error);
      setIsSubmitting(false);
      setStatus('idle');

      if (error.message === 'SNOWFLAKE_TIMEOUT') {
        Alert.alert(
          'Network Timeout',
          'Snowflake request timed out. Check your internet connection and retry.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: handleCheckIn },
          ]
        );
        return;
      }

      Alert.alert(
        'Check-In Failed',
        error.message || 'An unexpected error occurred. Please try again.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: handleCheckIn },
        ]
      );
    }
  };

  const gpsReady = !!liveLocation && !locationPermissionDenied && Number(liveLocation?.accuracy || 999) <= GPS_ACCURACY_THRESHOLD_M;

  const getProximityMessage = () => {
    if (locationPermissionDenied) {
      return {
        text: 'Location access is required to continue.',
        color: '#FF4444',
      };
    }

    if (!liveLocation) {
      return {
        text: 'Acquiring GPS signal...',
        color: '#888888',
      };
    }

    const roundedAccuracy = Math.round(liveLocation.accuracy || 0);
    if (roundedAccuracy > GPS_ACCURACY_THRESHOLD_M) {
      return {
        text: `📡 Refining location accuracy — ±${roundedAccuracy}m`,
        color: '#FFB800',
      };
    }

    if (isCheckingGeofence) {
      return {
        text: '📡 Verifying classroom proximity...',
        color: '#888888',
      };
    }

    if (proximityState === 'inside') {
      return {
        text: `✅ You are inside ${resolvedBuildingName}`,
        color: '#00C864',
      };
    }

    if (proximityState === 'unavailable') {
      return {
        text: '⚠️ Classroom proximity could not be verified right now',
        color: '#FFB800',
      };
    }

    return {
      text: `⚠️ Not inside ${resolvedBuildingName}`,
      color: '#FFB800',
    };
  };

  const getStatusLabel = () => {
    if (status === 'biometric')  return '🔐 Verifying identity...';
    if (status === 'gps')        return '📡 Reading GPS...';
    if (status === 'submitting') return '☁️  Submitting attendance...';
    return null;
  };

  const proximityMessage = getProximityMessage();

  return (
    <View style={styles.container}>

      {/* ── GPS Status Card ── */}
      <View style={styles.gpsCard}>
        {locationPermissionDenied ? (
          <>
            <Text style={styles.gpsIcon}>⛔</Text>
            <Text style={styles.gpsTitle}>Location Permission Denied</Text>
            <Text style={styles.gpsSub}>
              Enable location access in device Settings, then reopen this screen.
            </Text>
          </>
        ) : !liveLocation ? (
          <>
            <ActivityIndicator color="#00D4FF" size="large" />
            <Text style={styles.gpsTitle}>Acquiring GPS signal...</Text>
            <Text style={styles.gpsSub}>Acquiring your location…</Text>
          </>
        ) : (
          <>
            <Text style={styles.gpsIcon}>📍</Text>
            <Text style={styles.gpsTitle}>GPS Locked</Text>
            <Text style={styles.gpsSub}>Accuracy: ±{Math.round(liveLocation.accuracy)} m</Text>
            {isCheckingGeofence && (
              <ActivityIndicator color="#00D4FF" size="small" style={styles.inlineSpinner} />
            )}
            <Text style={[styles.proximityText, { color: proximityMessage.color }]}>
              {proximityMessage.text}
            </Text>
            {(proximityState === 'outside' || proximityState === 'unavailable') && !isCheckingGeofence && (
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={handleRefreshProximity}
                accessibilityLabel="Refresh classroom proximity"
                accessibilityHint="Runs classroom proximity verification again"
              >
                <Text style={styles.refreshButtonText}>REFRESH PROXIMITY</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* ── Session Info ── */}
      <View style={styles.infoCard}>
        <Row label="Student ID" value={studentId} />
        <Row label="Course"     value={selectedCourseTitle || courseId} />
        <Row label="Classroom"  value={selectedBuildingName || selectedClassId || '—'} />
        <Row label="Room ID"    value={selectedClassId || '—'} />
      </View>

      {/* ── Action ── */}
      <View style={styles.bottomPanel}>
        {status === 'done' ? (
          <Text style={styles.doneText}>✅ Attendance recorded</Text>
        ) : isSubmitting ? (
          <>
            <ActivityIndicator size="large" color="#00D4FF" />
            <Text style={styles.statusLabel}>{getStatusLabel()}</Text>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.button, !gpsReady && styles.buttonDisabled]}
            onPress={handleCheckIn}
            disabled={!gpsReady || isSubmitting}
            accessibilityLabel="Mark attendance"
            accessibilityHint="Starts biometric verification and attendance submission"
          >
            <Text style={styles.buttonText}>MARK ATTENDANCE</Text>
            {!gpsReady && (
              <Text style={styles.buttonSub}>
                {locationPermissionDenied
                  ? 'Location permission required'
                  : Platform.OS === 'web'
                    ? `Waiting for location fix ≤${GPS_ACCURACY_THRESHOLD_M}m (currently ±${Math.round(liveLocation?.accuracy || 999)}m)…`
                    : `Waiting for GPS fix ≤${GPS_ACCURACY_THRESHOLD_M} m…`}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {status === 'done' && perfMetrics && (
          <View style={styles.debugPanel}>
            <TouchableOpacity
              style={styles.debugHeader}
              onPress={() => setShowPerfDebug((prev) => !prev)}
              accessibilityLabel="Toggle performance debug panel"
              accessibilityHint="Expands or collapses attendance timing metrics"
            >
              <Text style={styles.debugTitle}>Performance Debug</Text>
              <Text style={styles.debugChevron}>{showPerfDebug ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {showPerfDebug && (
              <View style={styles.debugBody}>
                <DebugRow label="T1: Tap → Biometric prompt" value={`${perfMetrics.t1} ms`} />
                <DebugRow label="T2: Biometric success → GPS start" value={`${perfMetrics.t2} ms`} />
                <DebugRow label="T3: GPS complete → Snowflake sent" value={`${perfMetrics.t3} ms`} />
                <DebugRow label="T4: Snowflake sent → Response" value={`${perfMetrics.t4} ms`} />
                <DebugRow label="T5: Total end-to-end" value={`${perfMetrics.t5} ms`} />
              </View>
            )}
          </View>
        )}
      </View>

    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function DebugRow({ label, value }) {
  return (
    <View style={styles.debugRow}>
      <Text style={styles.debugLabel}>{label}</Text>
      <Text style={styles.debugValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#080810', padding: 20, justifyContent: 'center' },

  gpsCard: {
    backgroundColor: '#12121e',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e1e2e',
  },
  gpsIcon:   { fontSize: 40, marginBottom: 10 },
  gpsTitle:  { color: '#ffffff', fontSize: 18, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  gpsSub:    { color: '#888888', fontSize: 13, textAlign: 'center' },
  inlineSpinner: {
    marginTop: 8,
  },
  refreshButton: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    backgroundColor: '#080810',
  },
  refreshButtonText: {
    color: '#00D4FF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  proximityText: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },

  infoCard: {
    backgroundColor: '#12121e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#1e1e2e',
  },
  row:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  rowLabel:   { color: '#555555', fontSize: 12 },
  rowValue:   { color: '#00D4FF', fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 },

  bottomPanel: { alignItems: 'center' },
  button:      { width: '100%', backgroundColor: '#00D4FF', padding: 18, borderRadius: 14, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#12121e', borderWidth: 1, borderColor: '#1e1e2e', opacity: 0.8 },
  buttonText:  { color: '#080810', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  buttonSub:   { color: '#555555', fontSize: 11, marginTop: 4, textAlign: 'center' },
  doneText:    { color: '#00C864', fontSize: 16, fontWeight: '700', marginTop: 12 },
  statusLabel: { color: '#888888', fontSize: 13, marginTop: 10 },

  debugPanel: {
    width: '100%',
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#12121e',
    borderWidth: 1,
    borderColor: '#1e1e2e',
  },
  debugHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debugTitle: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '700',
  },
  debugChevron: {
    color: '#888888',
    fontSize: 12,
  },
  debugBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 6,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debugLabel: {
    color: '#555555',
    fontSize: 11,
    flexShrink: 1,
    marginRight: 8,
  },
  debugValue: {
    color: '#888888',
    fontSize: 11,
    fontWeight: '700',
  },
});