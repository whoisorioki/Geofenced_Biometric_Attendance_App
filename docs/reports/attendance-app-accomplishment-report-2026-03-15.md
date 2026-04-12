# Attendance App Accomplishment Report

**Date:** 2026-03-15  
**Project:** JKUAT Attendance App (Expo + Snowflake)

## 1) Executive Summary
The attendance platform is now operational with core controls in place for **identity**, **time window**, and **geofence location**. The mobile app flow is stabilized, the timetable/classroom data model is populated, and the admin dashboard has been upgraded for audit and board-level oversight.

## 2) Major Accomplishments

### A. UX and Flow Stabilization
- Simplified student journey to **Login → ClassSelect → Mark Attendance**.
- Reduced friction by loading predetermined sessions directly.

### B. Data & Schema Recovery
- Fixed SQL/schema drift issues (including legacy typo impacts and missing timetable columns).
- Seeded and aligned:
  - `DIM_COURSE` (8 MCS 4.2 sessions)
  - `DIM_CLASSROOM` (13 rows including compatibility row `LT_01`)
- Confirmed course-to-classroom joins return correct building metadata.

### C. Mark Attendance Hardening (Policy Engine)
- Implemented policy-based check-in logic in app SQL:
  - `PROXY-BLOCKED` (device mismatch)
  - `WRONG-TIME-OR-DAY` (outside scheduled timetable window)
  - `ABSENT-OUT-OF-BOUNDS` (outside classroom geofence)
  - `PRESENT` (all controls passed)
- Added post-insert status readback for accurate user feedback and safe retries.
- Maintained crash-safe biometric and GPS error handling paths.

### D. Timezone & History Improvements
- History screen now renders Snowflake timestamp output as **EAT display text**.
- Added status rendering support for `WRONG-TIME-OR-DAY` in mobile history UI.
- Prepared global timezone script to set API user timezone to Africa/Nairobi.

### E. Admin Dashboard (Streamlit v2)
- Delivered multi-tab dashboard for operations and oversight:
  - **Attendance Live** (KPIs + map)
  - **Audit** (policy compliance checks + breakdown)
  - **Geofence + Timetable** (inventory + academic schedule)
- Implemented Snowsight-native session bootstrapping via `get_active_session()`.
- Fixed Streamlit cache hashing issue by underscore-prefixed cached session parameters.
- Fixed coordinate extraction to use direct `ST_X` / `ST_Y` on Snowflake geospatial point column.

### F. Release Operations (OTA)
- Multiple OTA updates were published during iterative stabilization.
- Most recent published OTA group in this cycle: `fd884a42-89eb-4853-96cb-618a05cdea14`.

## 3) Current Verified Data Snapshot
From live verification checks:
- `DIM_COURSE`: **8 rows**
- `DIM_CLASSROOM`: **13 rows**
- `DIM_STUDENT`: **1 row**
- `FACT_ATTENDANCE`: **4 rows**

## 4) Attendance Audit Status (Current Sample)
Latest audit sample indicates:
- `place=OK, time=WRONG_DAY`: **1**
- `place=NO_TIMETABLE, time=NO_TIMETABLE`: **4**

Interpretation:
- One record matched expected classroom but failed timetable day window.
- Legacy `ICS301` records remain outside current timetable mapping and are flagged as non-timetable.

## 5) Timezone Clarification
Initial diagnostics showed session output in Pacific offset (`-0700`), which explained visible day/time confusion.

### Global fix prepared (Snowsight)
```sql
ALTER USER ATTENDANCE_API_USER SET TIMEZONE = 'Africa/Nairobi';
```

Status: **SQL script prepared** in repository for execution by ACCOUNTADMIN.

## 6) Artifacts Added/Updated

### App / UI
- `src/screens/MarkAttendanceScreen.jsx`
- `src/screens/HistoryScreen.jsx`

### SQL / Governance
- `database/sql/setup.sql`
- `database/sql/timezone.sql`
- `database/sql/fact_login.sql`
- `database/sql/timetable_patch.sql`

### Verification & Reporting Scripts
- `scripts/attendance-audit.js`
- `scripts/check-timezone.js`
- `scripts/streamlit-dashboard-v2.py`

## 7) Remaining Actions (Final Mile)
1. Run timezone script in Snowsight as ACCOUNTADMIN (`timezone.sql`).
2. Run/confirm `FACT_LOGIN` table creation (`fact_login.sql`) if audit trail per login is required.
3. Backfill or retire legacy `ICS301` records to reduce `NO_TIMETABLE` audit noise.
4. Seed additional `DIM_STUDENT` rows for real cohort rollout.
5. Complete `ClassSelectScreen` final pass (already queued as next implementation step).

## 8) Board-Level Conclusion
The system has moved from prototype behavior to controlled operation with measurable policy enforcement. It now provides both **real-time operational visibility** and **auditable compliance signals** (identity, schedule, location), with only rollout finalization tasks remaining.
