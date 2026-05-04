"""
JKUAT Attendance Governance Dashboard v3
Audience: Dean, Lecturers, Exam Officers
Design: Streamlit native — clean authority, data-first
"""

import pandas as pd
import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime

try:
    from snowflake.snowpark.context import get_active_session
except Exception:
    get_active_session = None

# ─────────────────────────────────────────────────────────────────
# PAGE CONFIG
# ─────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="JKUAT Attendance System",
    layout="wide",
    initial_sidebar_state="expanded",
    menu_items={
        "About": "JKUAT Attendance Governance Dashboard v3"
    }
)

# ─────────────────────────────────────────────────────────────────
# STREAMLIT THEME COLORS (Native)
# ─────────────────────────────────────────────────────────────────
PRIMARY_COLOR = "#0084FF"      # Streamlit primary blue
SUCCESS_COLOR = "#09AB3B"      # Green (present)
ERROR_COLOR = "#FF2B2B"        # Red (blocked/error)
WARNING_COLOR = "#FFA421"      # Orange (out of bounds)
SECONDARY_COLOR = "#5D5DFF"    # Purple (wrong time)
NEUTRAL_COLOR = "#808080"      # Gray (neutral)

STATUS_COLORS = {
    "PRESENT":              SUCCESS_COLOR,
    "PROXY-BLOCKED":        ERROR_COLOR,
    "ABSENT-OUT-OF-BOUNDS": WARNING_COLOR,
    "WRONG-TIME-OR-DAY":    SECONDARY_COLOR,
}

# ─────────────────────────────────────────────────────────────────
# SESSION
# ─────────────────────────────────────────────────────────────────
def get_session():
    if get_active_session is None:
        st.error("Run this app inside Snowsight Streamlit.")
        st.stop()
    try:
        return get_active_session()
    except Exception as exc:
        st.error(f"Session error: {exc}")
        st.stop()

def run_query(session, sql):
    return session.sql(sql).to_pandas()

# ─────────────────────────────────────────────────────────────────
# DATA LOADERS
# ─────────────────────────────────────────────────────────────────
@st.cache_data(ttl=60)
def load_attendance(_session):
    return run_query(_session, """
        WITH COURSE_LATEST AS (
          SELECT COURSE_ID, COURSE_TITLE, CLASS_ID, DAY_OF_WEEK,
                 START_TIME, END_TIME,
                 ROW_NUMBER() OVER (PARTITION BY COURSE_ID ORDER BY CREATED_AT DESC) RN
          FROM ATTENDANCE_DB.CORE.DIM_COURSE
        )
        SELECT
          F.ATTENDANCE_ID,
          F.STUDENT_ID,
          F.COURSE_ID,
          COALESCE(CL.COURSE_TITLE, F.COURSE_ID) AS COURSE_TITLE,
          F.CLASS_ID,
          C.BUILDING_NAME,
          C.ROOM_NUMBER,
          F.STATUS,
          TO_VARCHAR(CONVERT_TIMEZONE('Africa/Nairobi', F.CHECK_IN_TIME),
                     'YYYY-MM-DD HH24:MI:SS') AS CHECK_IN_TIME_EAT,
          ST_X(F.DEVICE_LOCATION) AS LONGITUDE,
          ST_Y(F.DEVICE_LOCATION) AS LATITUDE
        FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE F
        LEFT JOIN ATTENDANCE_DB.CORE.DIM_CLASSROOM C ON C.CLASS_ID = F.CLASS_ID
        LEFT JOIN COURSE_LATEST CL ON CL.COURSE_ID = F.COURSE_ID AND CL.RN = 1
        ORDER BY F.CHECK_IN_TIME DESC
        LIMIT 200
    """)

@st.cache_data(ttl=60)
def load_audit(_session):
    return run_query(_session, """
        WITH COURSE_LATEST AS (
          SELECT COURSE_ID, CLASS_ID, DAY_OF_WEEK, START_TIME, END_TIME,
                 ROW_NUMBER() OVER (PARTITION BY COURSE_ID ORDER BY CREATED_AT DESC) RN
          FROM ATTENDANCE_DB.CORE.DIM_COURSE
        ),
        X AS (
          SELECT
            F.ATTENDANCE_ID,
            F.STUDENT_ID,
            F.COURSE_ID,
            F.CLASS_ID AS RECORDED_CLASS_ID,
            CL.CLASS_ID AS EXPECTED_CLASS_ID,
            F.STATUS,
            TO_VARCHAR(CONVERT_TIMEZONE('Africa/Nairobi', F.CHECK_IN_TIME),
                       'YYYY-MM-DD HH24:MI:SS') AS CHECK_IN_TIME_EAT,
            CASE DAYOFWEEKISO(F.CHECK_IN_TIME)
              WHEN 1 THEN 'MONDAY'    WHEN 2 THEN 'TUESDAY'
              WHEN 3 THEN 'WEDNESDAY' WHEN 4 THEN 'THURSDAY'
              WHEN 5 THEN 'FRIDAY'    WHEN 6 THEN 'SATURDAY'
              ELSE 'SUNDAY'
            END AS CHECKIN_DAY,
            CL.DAY_OF_WEEK AS EXPECTED_DAY,
            CL.START_TIME, CL.END_TIME,
            TO_VARCHAR(TO_TIME(CONVERT_TIMEZONE('Africa/Nairobi', F.CHECK_IN_TIME)),
                       'HH24:MI') AS CHECKIN_CLOCK
          FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE F
          LEFT JOIN COURSE_LATEST CL ON CL.COURSE_ID = F.COURSE_ID AND CL.RN = 1
        )
        SELECT *,
          CASE
            WHEN EXPECTED_CLASS_ID IS NULL THEN 'NO_TIMETABLE'
            WHEN RECORDED_CLASS_ID = EXPECTED_CLASS_ID THEN 'OK'
            ELSE 'MISMATCH'
          END AS PLACE_CHECK,
          CASE
            WHEN EXPECTED_DAY IS NULL OR START_TIME IS NULL OR END_TIME IS NULL THEN 'NO_TIMETABLE'
            WHEN CHECKIN_DAY <> EXPECTED_DAY THEN 'WRONG_DAY'
            WHEN TO_TIME(CHECKIN_CLOCK) BETWEEN TO_TIME(START_TIME) AND TO_TIME(END_TIME) THEN 'ON_TIME_WINDOW'
            ELSE 'OUTSIDE_TIME_WINDOW'
          END AS TIME_CHECK
        FROM X
        ORDER BY CHECK_IN_TIME_EAT DESC
        LIMIT 500
    """)

@st.cache_data(ttl=60)
def load_timetable(_session):
    return run_query(_session, """
        SELECT D.COURSE_ID, D.COURSE_TITLE, D.LECTURER_NAME,
               D.DAY_OF_WEEK, D.START_TIME, D.END_TIME,
               D.CLASS_ID, C.BUILDING_NAME, C.ROOM_NUMBER
        FROM ATTENDANCE_DB.CORE.DIM_COURSE D
        LEFT JOIN ATTENDANCE_DB.CORE.DIM_CLASSROOM C ON C.CLASS_ID = D.CLASS_ID
        ORDER BY
          CASE D.DAY_OF_WEEK
            WHEN 'MONDAY' THEN 1 WHEN 'TUESDAY' THEN 2
            WHEN 'WEDNESDAY' THEN 3 WHEN 'THURSDAY' THEN 4
            WHEN 'FRIDAY' THEN 5 ELSE 6
          END, D.START_TIME
    """)

@st.cache_data(ttl=300)
def load_geofence(_session):
    return run_query(_session, """
        SELECT CLASS_ID, BUILDING_NAME, ROOM_NUMBER,
               ROUND(ST_AREA(GEOFENCE_POLYGON), 1) AS AREA_SQ_M,
               ST_NPOINTS(GEOFENCE_POLYGON) AS NODES
        FROM ATTENDANCE_DB.CORE.DIM_CLASSROOM
        ORDER BY CLASS_ID
    """)

# ─────────────────────────────────────────────────────────────────
# SIDEBAR
# ─────────────────────────────────────────────────────────────────
session = get_session()

with st.sidebar:
    st.title("🎓 JKUAT Attendance")
    st.caption("Governance Dashboard v3")
    st.divider()

    st.subheader("🔍 Filters", divider="blue")

    # Load course list for filter
    try:
        courses_df = run_query(session, """
            SELECT DISTINCT COURSE_ID, COURSE_TITLE
            FROM ATTENDANCE_DB.CORE.DIM_COURSE
            ORDER BY COURSE_ID
        """)
        course_options = ["All Courses"] + [
            f"{r.COURSE_ID} — {r.COURSE_TITLE}"
            for _, r in courses_df.iterrows()
        ]
    except Exception:
        course_options = ["All Courses"]

    selected_course = st.selectbox(
        "📚 Course Filter",
        course_options,
        index=0,
        help="Select a specific course or view all"
    )

    # Optional date filter
    use_date_filter = st.checkbox(
        "📅 Filter by Date",
        value=False,
        help="Enable to filter records by a specific date"
    )

    selected_date = None
    if use_date_filter:
        selected_date = st.date_input(
            "Select Date",
            value=pd.Timestamp.today(),
            help="Show records from this date"
        )

    # Optional date range filter
    use_date_range = st.checkbox(
        "📅 Filter by Date Range",
        value=False,
        help="Enable to filter records by date range"
    )

    date_range = (None, None)
    if use_date_range:
        col_start, col_end = st.columns(2)
        with col_start:
            start_date = st.date_input(
                "From",
                value=pd.Timestamp.today() - pd.Timedelta(days=7),
                help="Start date"
            )
        with col_end:
            end_date = st.date_input(
                "To",
                value=pd.Timestamp.today(),
                help="End date"
            )
        date_range = (start_date, end_date)

    st.divider()

    if st.button("🔄 Refresh Data", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

    st.divider()
    st.caption("💡 Tip: Data refreshes every 60 seconds")
    st.caption("📍 MCS 4.2 Cohort · Juja Campus")

# ─────────────────────────────────────────────────────────────────
# PAGE HEADER
# ─────────────────────────────────────────────────────────────────
st.title("📊 Attendance Governance Dashboard")
st.caption(f"JKUAT · MCS 4.2 · {datetime.now().strftime('%A, %d %B %Y')}")
st.divider()

# ─────────────────────────────────────────────────────────────────
# LOAD DATA
# ─────────────────────────────────────────────────────────────────
df_all     = load_attendance(session)
audit_df   = load_audit(session)
timetable  = load_timetable(session)
geofence   = load_geofence(session)

# Start with all data
df = df_all.copy()

# Apply course filter
if selected_course != "All Courses" and not df.empty:
    course_id = selected_course.split(" — ")[0]
    df = df[df["COURSE_ID"] == course_id]

# Apply date filter (single date)
if use_date_filter and selected_date and not df.empty and "CHECK_IN_TIME_EAT" in df.columns:
    df = df[df["CHECK_IN_TIME_EAT"].str.startswith(str(selected_date))]

# Apply date range filter
if use_date_range and date_range[0] and date_range[1] and not df.empty and "CHECK_IN_TIME_EAT" in df.columns:
    start_str = str(date_range[0])
    end_str = str(date_range[1])
    df = df[(df["CHECK_IN_TIME_EAT"] >= start_str) & (df["CHECK_IN_TIME_EAT"] < end_str)]

# ─────────────────────────────────────────────────────────────────
# TABS
# ─────────────────────────────────────────────────────────────────
tab1, tab2, tab3 = st.tabs([
    "📋 Live Attendance",
    "🔍 Compliance Audit",
    "🗺️ Timetable & Geofence",
])

# ═══════════════════════════════════════════════════════════════════
# TAB 1 — LIVE ATTENDANCE
# ═══════════════════════════════════════════════════════════════════
with tab1:

    # ── KPI Row ──────────────────────────────────────────────────
    total    = len(df)
    present  = int((df["STATUS"] == "PRESENT").sum()) if not df.empty else 0
    blocked  = int((df["STATUS"] == "PROXY-BLOCKED").sum()) if not df.empty else 0
    wrong_t  = int((df["STATUS"] == "WRONG-TIME-OR-DAY").sum()) if not df.empty else 0
    absent   = int((df["STATUS"] == "ABSENT-OUT-OF-BOUNDS").sum()) if not df.empty else 0
    rate     = f"{round((present / total) * 100)}%" if total > 0 else "—"

    col_metrics = st.columns(6)
    col_metrics[0].metric("Total Check-ins", total)
    col_metrics[1].metric("✅ Present", present, delta_color="off")
    col_metrics[2].metric("Attendance Rate", rate, delta_color="off")
    col_metrics[3].metric("📍 Out of Bounds", absent, delta_color="inverse")
    col_metrics[4].metric("⏰ Wrong Time/Day", wrong_t, delta_color="inverse")
    col_metrics[5].metric("🚫 Proxy Blocked", blocked, delta_color="inverse")

    st.divider()

    if df.empty:
        st.warning("⚠️ No attendance records found for the selected date and course. Adjust the filters or wait for check-ins.")
    else:
        # ── Status distribution donut ─────────────────────────────
        col_chart, col_table = st.columns([1, 2])

        with col_chart:
            st.subheader("Status Distribution", divider="blue")
            status_counts = df["STATUS"].value_counts().reset_index()
            status_counts.columns = ["STATUS", "COUNT"]

            fig_donut = go.Figure(go.Pie(
                labels=status_counts["STATUS"],
                values=status_counts["COUNT"],
                hole=0.6,
                marker_colors=[STATUS_COLORS.get(s, NEUTRAL_COLOR)
                                for s in status_counts["STATUS"]],
                textinfo="percent",
                textfont_size=12,
                hovertemplate="<b>%{label}</b><br>Count: %{value}<br>%{percent}<extra></extra>",
            ))
            fig_donut.add_annotation(
                text=f"<b>{total}</b><br><span style='font-size:10px'>records</span>",
                x=0.5, y=0.5, showarrow=False,
                font_size=16, align="center"
            )
            fig_donut.update_layout(
                showlegend=True,
                legend=dict(orientation="h", yanchor="bottom", y=-0.2,
                            xanchor="center", x=0.5, font_size=10),
                margin=dict(t=0, b=40, l=0, r=0),
                height=280,
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
            )
            st.plotly_chart(fig_donut, use_container_width=True, config={"displayModeBar": False})

        with col_table:
            st.subheader("Attendance Roll", divider="blue")
            display_cols = ["STUDENT_ID", "COURSE_TITLE", "BUILDING_NAME",
                            "STATUS", "CHECK_IN_TIME_EAT"]
            available = [c for c in display_cols if c in df.columns]

            display_df = df[available].rename(columns={
                "STUDENT_ID":       "Student",
                "COURSE_TITLE":     "Course",
                "BUILDING_NAME":    "Building",
                "STATUS":           "Status",
                "CHECK_IN_TIME_EAT": "Check-in Time (EAT)",
            }).head(10)

            st.dataframe(display_df, use_container_width=True, height=280)

        # ── Map ───────────────────────────────────────────────────
        map_df = df.dropna(subset=["LATITUDE", "LONGITUDE"]).copy()
        if not map_df.empty:
            st.subheader("GPS Check-in Locations", divider="blue")

            fig_map = px.scatter_map(
                map_df,
                lat="LATITUDE",
                lon="LONGITUDE",
                color="STATUS",
                color_discrete_map=STATUS_COLORS,
                hover_data={
                    "STUDENT_ID": True,
                    "COURSE_TITLE": True,
                    "CHECK_IN_TIME_EAT": True,
                    "BUILDING_NAME": True,
                    "LATITUDE": False,
                    "LONGITUDE": False,
                },
                zoom=15,
                height=400,
            )
            fig_map.update_layout(
                margin=dict(t=0, b=0, l=0, r=0),
                legend=dict(
                    orientation="h", yanchor="bottom", y=0.01,
                    xanchor="right", x=0.99,
                    bgcolor="rgba(255,255,255,0.85)",
                    font_size=10,
                ),
                paper_bgcolor="rgba(0,0,0,0)",
            )
            st.plotly_chart(fig_map, use_container_width=True, config={"displayModeBar": False})

# ═══════════════════════════════════════════════════════════════════
# TAB 2 — COMPLIANCE AUDIT
# ═══════════════════════════════════════════════════════════════════
with tab2:

    st.subheader("Policy Compliance Overview", divider="blue")

    if audit_df.empty:
        st.info("No audit data available.")
    else:
        # ── Summary metrics ───────────────────────────────────────
        total_a   = len(audit_df)
        ok_place  = int((audit_df["PLACE_CHECK"] == "OK").sum())
        on_time   = int((audit_df["TIME_CHECK"] == "ON_TIME_WINDOW").sum())
        no_tt     = int((audit_df["TIME_CHECK"] == "NO_TIMETABLE").sum())

        col_audit = st.columns(4)
        col_audit[0].metric("Records Audited", total_a)
        col_audit[1].metric("✅ Correct Location", f"{ok_place}/{total_a}",
                           delta=f"{round(ok_place/total_a*100)}% match" if total_a else None)
        col_audit[2].metric("⏱️ On Time", f"{on_time}/{total_a}",
                           delta=f"{round(on_time/total_a*100)}% on-time" if total_a else None)
        col_audit[3].metric("⚠️ No Timetable", no_tt,
                           delta="Governance gap" if no_tt > 0 else "None",
                           delta_color="inverse")

        st.divider()

        # ── Violation breakdown charts ────────────────────────────
        col_v1, col_v2 = st.columns(2)

        with col_v1:
            st.subheader("Location Compliance", divider="blue")
            place_counts = audit_df["PLACE_CHECK"].value_counts().reset_index()
            place_counts.columns = ["Check", "Count"]
            place_colors = {
                "OK": SUCCESS_COLOR, "MISMATCH": ERROR_COLOR, "NO_TIMETABLE": NEUTRAL_COLOR
            }
            fig_place = px.bar(
                place_counts, x="Check", y="Count",
                color="Check",
                color_discrete_map=place_colors,
                text="Count",
            )
            fig_place.update_traces(textposition="outside", marker_line_width=0)
            fig_place.update_layout(
                showlegend=False,
                xaxis_title="", yaxis_title="Records",
                margin=dict(t=10, b=10, l=0, r=0),
                height=250,
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
            )
            fig_place.update_yaxes(gridcolor="rgba(0,0,0,0.05)")
            fig_place.update_xaxes(showgrid=False)
            st.plotly_chart(fig_place, use_container_width=True, config={"displayModeBar": False})

        with col_v2:
            st.subheader("Time Window Compliance", divider="blue")
            time_counts = audit_df["TIME_CHECK"].value_counts().reset_index()
            time_counts.columns = ["Check", "Count"]
            time_colors = {
                "ON_TIME_WINDOW":    SUCCESS_COLOR,
                "WRONG_DAY":         ERROR_COLOR,
                "OUTSIDE_TIME_WINDOW": WARNING_COLOR,
                "NO_TIMETABLE":      NEUTRAL_COLOR,
            }
            fig_time = px.bar(
                time_counts, x="Check", y="Count",
                color="Check",
                color_discrete_map=time_colors,
                text="Count",
            )
            fig_time.update_traces(textposition="outside", marker_line_width=0)
            fig_time.update_layout(
                showlegend=False,
                xaxis_title="", yaxis_title="Records",
                margin=dict(t=10, b=10, l=0, r=0),
                height=250,
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
            )
            fig_time.update_yaxes(gridcolor="rgba(0,0,0,0.05)")
            fig_time.update_xaxes(showgrid=False)
            st.plotly_chart(fig_time, use_container_width=True, config={"displayModeBar": False})

        st.divider()

        # ── Audit table ───────────────────────────────────────────
        st.subheader("Full Audit Record", divider="blue")

        audit_display = audit_df[[
            "STUDENT_ID", "COURSE_ID", "STATUS",
            "CHECK_IN_TIME_EAT", "CHECKIN_DAY",
            "EXPECTED_DAY", "PLACE_CHECK", "TIME_CHECK"
        ]].rename(columns={
            "STUDENT_ID":        "Student",
            "COURSE_ID":         "Course",
            "STATUS":            "DB Status",
            "CHECK_IN_TIME_EAT": "Check-in (EAT)",
            "CHECKIN_DAY":       "Day Recorded",
            "EXPECTED_DAY":      "Day Expected",
            "PLACE_CHECK":       "Location",
            "TIME_CHECK":        "Time Window",
        }).head(100)

        st.dataframe(audit_display, use_container_width=True, height=350)

        # ── Download ──────────────────────────────────────────────
        st.divider()
        col_dl, _ = st.columns([1, 3])
        with col_dl:
            st.download_button(
                label="⬇️ Download Audit CSV",
                data=audit_df.to_csv(index=False),
                file_name=f"jkuat_attendance_audit_{pd.Timestamp.today().date()}.csv",
                mime="text/csv",
                use_container_width=True,
            )

# ═══════════════════════════════════════════════════════════════════
# TAB 3 — TIMETABLE & GEOFENCE
# ═══════════════════════════════════════════════════════════════════
with tab3:

    col_tt, col_geo = st.columns([3, 2])

    with col_tt:
        st.subheader("MCS 4.2 Academic Timetable", divider="blue")

        if timetable.empty:
            st.info("No timetable data found.")
        else:
            # Group by day for readable display
            days_order = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]
            for day in days_order:
                day_df = timetable[timetable["DAY_OF_WEEK"] == day]
                if day_df.empty:
                    continue

                st.markdown(f"### {day}", help="Daily schedule")

                for _, row in day_df.iterrows():
                    with st.container(border=True):
                        col_left, col_right = st.columns([2, 1])
                        with col_left:
                            st.markdown(f"**{row.get('COURSE_ID','—')}**")
                            st.markdown(f"**{row.get('COURSE_TITLE','—')}**")
                            st.caption(f"👤 {row.get('LECTURER_NAME','—')}")
                        with col_right:
                            st.metric(
                                "Time",
                                f"{str(row.get('START_TIME',''))[:5]} – {str(row.get('END_TIME',''))[:5]}"
                            )
                            st.caption(f"📍 {row.get('BUILDING_NAME','—')}")
                            st.caption(f"Room: {row.get('CLASS_ID','—')}")

    with col_geo:
        st.subheader("Geofence Inventory", divider="blue")

        if geofence.empty:
            st.info("No geofence data found.")
        else:
            for _, row in geofence.iterrows():
                area   = row.get("AREA_SQ_M", 0)
                nodes  = row.get("NODES", 0)
                status_color = "green" if area and float(area) > 0 else "red"
                status_label = "✅ Active" if area and float(area) > 0 else "❌ No polygon"

                with st.container(border=True):
                    st.markdown(f"**{row.get('BUILDING_NAME','—')}**")
                    st.caption(f"{row.get('CLASS_ID','—')}")
                    col_s1, col_s2 = st.columns([1, 1])
                    col_s1.metric("Room", row.get('ROOM_NUMBER','—'), label_visibility="collapsed")
                    col_s2.metric("Status", status_label, label_visibility="collapsed")
                    st.caption(f"🗺️ {area} m² · {nodes} pts")

        st.divider()
        st.subheader("System Health", divider="blue")

        total_classrooms = len(geofence)
        active_geofences = len(geofence[geofence["AREA_SQ_M"].notna() &
                                        (geofence["AREA_SQ_M"] > 0)]) if not geofence.empty else 0
        total_courses    = len(timetable)

        col_health = st.columns(3)
        col_health[0].metric("🏫 Classrooms", total_classrooms)
        col_health[1].metric("📡 Active Geofences", active_geofences)
        col_health[2].metric("📚 Scheduled Units", total_courses)

# ─────────────────────────────────────────────────────────────────
# FOOTER
# ─────────────────────────────────────────────────────────────────
st.divider()
st.caption("🔄 Data refreshes every 60 seconds · 📞 Support: attendance@jkuat.ac.ke")
