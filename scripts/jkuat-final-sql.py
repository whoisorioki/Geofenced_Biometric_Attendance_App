"""
JKUAT Final SQL Generator — 11 Confirmed Buildings
Uses 3 Overpass mirrors with retry + rate limiting to avoid 504 errors.
Run: python scripts/jkuat-final-sql.py
"""

import requests
import json
import time
from pathlib import Path

# 3 public Overpass mirrors — tries each on failure
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

CONFIRMED_BUILDINGS = {
    "CLB_01":     {"osm_id": 330898779,  "name": "Common Lecture Building (C.L.B)"},
    "IPIC_01":    {"osm_id": 1103908744, "name": "IPIC JKUAT"},
    "ITROMID_01": {"osm_id": 330999266,  "name": "ITROMID Lecture Hall"},
    "ELB_01":     {"osm_id": 330999263,  "name": "Engineering Lecture Building (E.L.B)"},
    "EMB_01":     {"osm_id": 330901652,  "name": "Engineering Main Building (E.M.B)"},
    "HRD_01":     {"osm_id": 330898780,  "name": "School of Human Resource Development (S.H.R.D)"},
    "NSC_LT":     {"osm_id": 330914425,  "name": "NSC Lecture Theatre"},
    "COHES_01":   {"osm_id": 330916154,  "name": "College of Health Sciences (COHES)"},
    "IEET_01":    {"osm_id": 330938676,  "name": "Institute of Energy and Environmental Technology (IEET)"},
    "JKAC_01":    {"osm_id": 330938677,  "name": "JKUAT Academic Centre (JKAC)"},
    "NCLB_01":    {"osm_id": 907642930,  "name": "New Common Lecture Building (NCLB)"},
}

def fetch_polygon(osm_id):
    query = f"[out:json][timeout:25];\nway({osm_id});\nout geom;"
    for attempt in range(3):
        for mirror in OVERPASS_MIRRORS:
            try:
                print(f"    [{mirror.split('/')[2]}]...", end=" ", flush=True)
                r = requests.post(mirror, data={"data": query}, timeout=25)
                if r.status_code == 200:
                    elements = r.json().get("elements", [])
                    if elements:
                        nodes = elements[0].get("geometry", [])
                        if nodes:
                            coords = [[n["lon"], n["lat"]] for n in nodes]
                            if coords[0] != coords[-1]:
                                coords.append(coords[0])
                            print("OK")
                            return coords
                print(f"empty")
            except requests.exceptions.Timeout:
                print("timeout")
            except Exception as e:
                print(f"err:{e}")
        wait = 8 * (attempt + 1)
        print(f"    All mirrors failed. Waiting {wait}s (attempt {attempt+2}/3)...")
        time.sleep(wait)
    return None

def centroid(coords):
    lats = [c[1] for c in coords]
    lons = [c[0] for c in coords]
    return round(sum(lats)/len(lats), 6), round(sum(lons)/len(lons), 6)

def main():
    print("JKUAT Final SQL Generator — 11 Buildings")
    print("=" * 60)

    sql = []
    sql.append("-- JKUAT DIM_CLASSROOM — 11 Confirmed Lecture Halls")
    sql.append("-- Source: OpenStreetMap real building polygons")
    sql.append("")
    sql.append("USE DATABASE ATTENDANCE_DB;")
    sql.append("USE SCHEMA CORE;")
    sql.append("TRUNCATE TABLE ATTENDANCE_DB.CORE.DIM_CLASSROOM;")
    sql.append("")

    success = 0
    failed = []

    for class_id, info in CONFIRMED_BUILDINGS.items():
        print(f"\n[{class_id}] {info['name']} (OSM {info['osm_id']})")
        coords = fetch_polygon(info["osm_id"])
        time.sleep(3)  # polite delay between requests

        if not coords:
            print(f"  FAILED — adding to failed list")
            failed.append(class_id)
            continue

        lat, lon = centroid(coords)
        geojson = json.dumps({"type": "Polygon", "coordinates": [coords]})
        print(f"  Nodes: {len(coords)-1} | Centroid: {lat}, {lon}")

        sql.append(f"-- {class_id}: {info['name']}")
        sql.append("INSERT INTO ATTENDANCE_DB.CORE.DIM_CLASSROOM (CLASS_ID, BUILDING_NAME, ROOM_NUMBER, GEOFENCE_POLYGON, CREATED_AT)")
        sql.append(
            f"VALUES ('{class_id}', '{info['name']}', '{class_id}', TO_GEOGRAPHY('{geojson}'), CURRENT_TIMESTAMP());"
        )
        sql.append("")
        success += 1

    sql.append("-- Verification query")
    sql.append("SELECT CLASS_ID, BUILDING_NAME,")
    sql.append("       ROUND(ST_AREA(GEOFENCE_POLYGON), 1) AS AREA_SQ_M,")
    sql.append("       ST_NPOINTS(GEOFENCE_POLYGON) AS POLYGON_NODES,")
    sql.append("       CREATED_AT")
    sql.append("FROM ATTENDANCE_DB.CORE.DIM_CLASSROOM ORDER BY CLASS_ID;")

    output = "\n".join(sql)

    output_path = Path(__file__).resolve().parent.parent / "database" / "sql" / "jkuat_classrooms_final.sql"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output, encoding="utf-8")

    print("\n" + "=" * 60)
    print(f"Result: {success}/11 buildings fetched successfully")
    if failed:
        print(f"Failed: {failed}")
    print(f"SQL written to: {output_path}")
    print("Paste into Snowsight and run.")

if __name__ == "__main__":
    main()
