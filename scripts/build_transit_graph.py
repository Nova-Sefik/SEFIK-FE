"""Build a compact zone-to-zone scheduled transit graph from cached GTFS.

The output supports feasibility screening; it is not a street router. Each edge
is a median scheduled ride time between adjacent demand zones on one route for
the representative weekday 2026-09-02.
"""

import csv
import io
import json
import math
import os
import re
import statistics
import zipfile
from collections import defaultdict
from datetime import date


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'scripts', '.gtfs_cache', 'zips')
DEMAND = os.path.join(ROOT, 'src', 'data', 'demand.json')
OUTPUT = os.path.join(ROOT, 'src', 'data', 'transit-graph.json')
SERVICE_DATE = date(2026, 9, 2)


def rows(zipped, name):
    if name not in zipped.namelist():
        return []
    with zipped.open(name) as handle:
        return list(csv.DictReader(io.TextIOWrapper(handle, encoding='utf-8-sig')))


def stream_rows(zipped, name):
    with zipped.open(name) as handle:
        yield from csv.DictReader(io.TextIOWrapper(handle, encoding='utf-8-sig'))


def active_services(zipped):
    ymd = SERVICE_DATE.strftime('%Y%m%d')
    weekday = SERVICE_DATE.strftime('%A').lower()
    active = {
        row['service_id']
        for row in rows(zipped, 'calendar.txt')
        if row['start_date'] <= ymd <= row['end_date'] and row[weekday] == '1'
    }
    for row in rows(zipped, 'calendar_dates.txt'):
        if row['date'] != ymd:
            continue
        if row['exception_type'] == '1':
            active.add(row['service_id'])
        else:
            active.discard(row['service_id'])
    return active


def minute(value):
    if not value:
        return None
    hour, mins, seconds = map(int, value.split(':'))
    return hour * 60 + mins + seconds / 60


def nearest_zone(lat, lon, zones):
    coslat = math.cos(math.radians(lat))
    return min(
        zones,
        key=lambda zone: ((zone['lat'] - lat) * 110.54) ** 2
        + ((zone['lon'] - lon) * 111.32 * coslat) ** 2,
    )['id']


def latest_feeds():
    feeds = {}
    for filename in os.listdir(CACHE):
        match = re.match(r'(.+)_([0-9]{8})\.zip$', filename)
        if not match or match.group(2) > SERVICE_DATE.strftime('%Y%m%d'):
            continue
        agency, start = match.groups()
        if agency not in feeds or start > feeds[agency][0]:
            feeds[agency] = (start, os.path.join(CACHE, filename))
    return [value[1] for value in feeds.values()]


def main():
    with open(DEMAND, encoding='utf-8') as handle:
        demand = json.load(handle)
    zones = demand['zones']
    group_names = demand['groups']
    agency_group = {
        'IA2N9': 'metro', 'IA9T6': 'carris',
        'LA77N': 'cm', 'BNA17': 'cm', 'YA15B': 'cm', 'A2L1N': 'cm',
        'HF16N': 'other', 'LTP61': 'other', '7NTB1': 'other', 'N18KL': 'other',
    }
    samples = defaultdict(list)
    sources = []

    for path in sorted(latest_feeds()):
        agency = os.path.basename(path).split('_')[0]
        with zipfile.ZipFile(path) as zipped:
            active = active_services(zipped)
            route_info = {}
            for row in rows(zipped, 'routes.txt'):
                line = (row.get('line_id') or row.get('route_short_name') or row.get('line_short_name') or row['route_id']).strip()
                long_name = (row.get('line_long_name') or row.get('route_long_name') or '').strip()
                route_info[row['route_id']] = {
                    'id': f'{agency}:{line}',
                    'line': line,
                    'label': long_name or line,
                    'mode': agency_group.get(agency, 'other'),
                    'operator': group_names.get(agency_group.get(agency, 'other'), agency),
                }
            trip_route = {
                row['trip_id']: row['route_id']
                for row in rows(zipped, 'trips.txt')
                if row['service_id'] in active and row['route_id'] in route_info
            }
            stop_zone = {
                row['stop_id']: nearest_zone(float(row['stop_lat']), float(row['stop_lon']), zones)
                for row in rows(zipped, 'stops.txt')
                if row.get('stop_lat') and row.get('stop_lon')
            }

            current_trip = None
            visits = []

            def consume(trip_id, trip_visits):
                if not trip_id or len(trip_visits) < 2:
                    return
                route = route_info[trip_route[trip_id]]
                compressed = []
                for zone, arrival, departure in trip_visits:
                    if arrival is None or departure is None:
                        continue
                    if compressed and compressed[-1][0] == zone:
                        compressed[-1] = (zone, compressed[-1][1], departure)
                    else:
                        compressed.append((zone, arrival, departure))
                # A graph edge represents one continuous ride, not merely the
                # few minutes spent crossing a zone boundary. Recording every
                # ordered zone pair preserves the full scheduled ride time and
                # lets the router count a transfer only when the route changes.
                for start in range(len(compressed) - 1):
                    for end in range(start + 1, len(compressed)):
                        before, after = compressed[start], compressed[end]
                        duration = after[1] - before[2]
                        if 0 < duration <= 180:
                            samples[(before[0], after[0], route['id'], route['line'], route['label'], route['mode'], route['operator'])].append(duration)

            for row in stream_rows(zipped, 'stop_times.txt'):
                trip_id = row['trip_id']
                if trip_id != current_trip:
                    consume(current_trip, visits)
                    current_trip, visits = trip_id, []
                if trip_id not in trip_route or row['stop_id'] not in stop_zone:
                    continue
                visits.append((stop_zone[row['stop_id']], minute(row.get('arrival_time')), minute(row.get('departure_time'))))
            consume(current_trip, visits)
            sources.append(os.path.basename(path))

    edges = []
    for (origin, destination, route_id, line, label, mode, operator), durations in samples.items():
        edges.append({
            'from': origin,
            'to': destination,
            'route_id': route_id,
            'line': line,
            'label': label,
            'mode': mode,
            'operator': operator,
            'median_minutes': round(statistics.median(durations), 1),
            'scheduled_trips': len(durations),
        })
    edges.sort(key=lambda edge: (edge['from'], edge['to'], edge['route_id']))
    output = {
        'schema_version': '1.0',
        'service_date': SERVICE_DATE.isoformat(),
        'method': 'Median scheduled travel time between adjacent demand zones on active GTFS trips.',
        'sources': sources,
        'edges': edges,
    }
    with open(OUTPUT, 'w', encoding='utf-8') as handle:
        json.dump(output, handle, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {OUTPUT}: {len(edges)} directed route edges from {len(sources)} GTFS feeds')


if __name__ == '__main__':
    main()
