# JKUAT Attendance Tracking Application

A React Native mobile application for biometric-enabled class attendance tracking at JKUAT, using GPS-based geofencing, real-time Snowflake database synchronization, and time-window enforcement.

## Overview

The attendance app provides:
- **Biometric Authentication**: Fingerprint/Face ID verification
- **GPS Geofencing**: Location-based classroom verification with adaptive accuracy thresholds
- **Real-Time Policy Engine**: Time-window and schedule-based attendance decisions
- **Timetable Integration**: Dynamic class schedule enforcement with day-of-week awareness
- **OTA Updates**: Seamless app updates via EAS without Play Store redeployment
- **Offline Resilience**: Graceful degradation when network connectivity is poor

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React Native (Expo) |
| **Authentication** | Biometric (React Native) + Device Hash |
| **Location** | expo-location (GPS watch + snapshot) |
| **Backend API** | Snowflake SQL API (JWT keypair auth) |
| **Database** | Snowflake (multi-schema design) |
| **Deployment** | EAS Build + OTA channels |
| **Tooling** | Node.js CLI scripts for SQL ops |

## Architecture

```
attendance-app/
├── src/
│   ├── screens/            # UI screens (Login, ClassSelect, MarkAttendance, etc.)
│   ├── services/           # Business logic (Snowflake, auth, location, device)
│   ├── navigation/         # React Navigation setup
│   ├── config/             # Environment & Snowflake configuration
│   └── styles/             # Shared stylesheet
├── database/
│   ├── sql/                # Repository SQL scripts for setup & patches
│   └── csv/                # Seed data (users, courses, classrooms)
├── scripts/                # Node CLI tools for Snowflake operations
├── patches/                # Expo & React Native patches
├── docs/                   # Accomplishment reports & architecture notes
└── eas.json               # EAS build configuration
```

## Screens & Components

### **LoginScreen**
- Biometric prompt (fingerprint/face)
- Device hash verification
- JWT token generation via Snowflake keypair

### **ClassSelectScreen**
- Parallel timetable schema load with status phases
- Building + room location labels
- Session selection for attendance marking

### **MarkAttendanceScreen**
- GPS acquisition (last-known + watcher + snapshot fallback)
- Platform-aware location threshold validation
- Proximity state machine (checking → inside/outside/unavailable)
- One-shot verification with manual refresh button
- Attendance submission with real-time feedback

### **HistoryScreen**
- View completed attendance records
- Filter by date/course

## Services

### **snowflake.service.js**
- JWT token generation (RSA keypair)
- SQL API request execution with retry/backoff logic
- Async result polling with configurable intervals
- Friendly network error handling

### **auth.service.js**
- Biometric authentication (Android/iOS)
- Device hash computation
- Token lifecycle management

### **location.service.js**
- GPS watcher initialization
- Snapshot fallback for slow GPS
- Proximity distance calculation (Haversine)
- Platform-aware accuracy thresholds (Android stricter than web)

### **classroom.service.js**
- Timetable schema retrieval
- Class schedule queries with day-of-week normalization
- Attendance submission with policy checking

### **device.service.js**
- Device identifier generation
- Hardware capability detection

## Setup & Installation

### Prerequisites
- Node.js 16+ and npm
- Snowflake account with SQL API enabled
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli` (for deployment)
- RSA keypair for Snowflake authentication

### Step 1: Clone & Install

```bash
git clone https://github.com/whoisorioki/Geofenced_Biometric_Attendance_App attendance-app
cd attendance-app
npm install
```

### Step 2: Configure Snowflake

1. **Generate RSA Keypair** (if not already done):
   ```bash
   openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.p8 -nocrypt
   openssl rsa -in rsa_key.p8 -pubout -out rsa_key.pub
   ```

2. **Set Snowflake User** with public key:
   ```sql
   ALTER USER <user> SET RSA_PUBLIC_KEY='<public-key-content>';
   ```

3. **Create `.env` file** in project root:
   ```
   SNOWFLAKE_ACCOUNT=<account-id>
   SNOWFLAKE_REGION=<region>
   SNOWFLAKE_USER=<api-user>
   SNOWFLAKE_WAREHOUSE=<warehouse>
   SNOWFLAKE_DATABASE=<database>
   SNOWFLAKE_SCHEMA=public
   PRIVATE_KEY=<rsa-private-key-content>
   PUBLIC_KEY_FINGERPRINT=<fingerprint>
   ```

### Step 3: Initialize Database

```bash
npm run sql database/sql/setup.sql
```

This creates schemas, tables, and loads seed data (classrooms, timetables, users).

### Step 4: Run Locally

**Web Browser:**
```bash
npm run web
```

**Expo Go (phone preview):**
```bash
npx expo start
# Then press 'i' (iOS) or 'a' (Android) in terminal, or scan QR code
```

**Android Phone (APK):**
```bash
npm run phone-preview
# Or: eas build --platform android --profile preview
```

## Deployment

### OTA Updates (Recommended for rapid iteration)

```bash
npm run publish
# or with specific channel:
eas update --channel=production
```

### Full EAS Build (APK/IPA)

```bash
eas build --platform android
```

See [eas.json](eas.json) for build profiles: `preview`, `production`, etc.

## SQL Operations via CLI

The project includes a generic SQL CLI for executing statements directly against Snowflake from Node:

```bash
# Inline SQL
npm run sql "SELECT * FROM timetable LIMIT 5;"

# From file
npm run sql database/sql/timetable_patch.sql

# With polling (for INSERT/UPDATE)
npm run sql --file database/sql/fact_login.sql
```

See [scripts/snowflake-sql-cli.js](scripts/snowflake-sql-cli.js) for full usage.

## Key Database Schemas

| Schema | Purpose |
|--------|---------|
| `public` | Users, departments, courses, classrooms |
| `timetable` | Class schedule (day, time, instructor, room) |
| `attendance` | Attendance records with policy decisions |
| `audit` | Login/logout events for analytics |

## Common Issues & Troubleshooting

### GPS Acquisition Slow
- GPS needs 5–15 seconds for first fix. App uses last-known location as fallback.
- Web browser doesn't support GPS; use Expo/Android APK.
- On simulator, manually set location in Xcode/Android Emulator settings.

### Attendance Blocked Despite Being in Class
- Check timetable row has correct time window (`start_time`, `end_time`) and day-of-week.
- Verify classroom location is within geofence threshold.
- Run `npm run sql "SELECT * FROM timetable WHERE course_id='<id>';"` to inspect schedule.

### Snowflake API Timeout
- Increase `pollMaxAttempts` in [src/services/snowflake.service.js](src/services/snowflake.service.js).
- Check warehouse is suspended; resume it in Snowsight.
- Verify JWT token and fingerprint match Snowflake user setup.

### OTA Update Not Showing
- Clear Expo app cache or reinstall.
- Use `expo-updates` in code to programmatically reload: `await Updates.reloadAsync()`.

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `npm run web` | Start Expo web preview |
| `npm run phone-preview` | Build Android preview APK via EAS |
| `npm run publish` | Publish OTA update to default channel |
| `npm run sql` | Execute SQL statements directly (see usage below) |
| `npm run lint` | Check code style (if configured) |

## References & Documentation

- [Snowflake SQL API Docs](https://docs.snowflake.com/en/developer-guide/sql-api/)
- [Expo Documentation](https://docs.expo.dev/)
- [React Native Biometrics](https://github.com/nozbe/react-native-biometrics)
- [Project Accomplishment Report](docs/reports/attendance-app-accomplishment-report-2026-03-15.md)

## License

JKUAT Internal Use

