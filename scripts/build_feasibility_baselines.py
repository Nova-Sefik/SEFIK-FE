"""Create indicative current-journey baselines for route opportunities.

This uses stop-level GTFS edges for the representative weekday, nearby-stop
walking links, and an assumed transfer wait. It intentionally excludes the
initial service wait, fares, reliability and accessibility constraints.
"""

import csv
import heapq
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
DEMAND_PATH = os.path.join(ROOT, 'src', 'data', 'demand.json')
OUTPUT = os.path.join(ROOT, 'src', 'data', 'feasibility-baselines.json')
SERVICE_DATE = date(2026, 9, 2)
TRANSFER_WAIT = 8
WALK_METRES_PER_MINUTE = 75
ANCHOR_RADIUS_M = 600
TRANSFER_RADIUS_M = 140


def read_rows(zipped, name):
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
        row['service_id'] for row in read_rows(zipped, 'calendar.txt')
        if row['start_date'] <= ymd <= row['end_date'] and row[weekday] == '1'
    }
    for row in read_rows(zipped, 'calendar_dates.txt'):
        if row['date'] == ymd:
            (active.add if row['exception_type'] == '1' else active.discard)(row['service_id'])
    return active


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


def minute(value):
    if not value:
        return None
    hour, mins, seconds = map(int, value.split(':'))
    return hour * 60 + mins + seconds / 60


def metres(lat1, lon1, lat2, lon2):
    dx = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110540
    return math.hypot(dx, dy)


def build_graph(demand):
    agency_group = {
        'IA2N9': 'metro', 'IA9T6': 'carris',
        'LA77N': 'cm', 'BNA17': 'cm', 'YA15B': 'cm', 'A2L1N': 'cm',
        'HF16N': 'other', 'LTP61': 'other', '7NTB1': 'other', 'N18KL': 'other',
    }
    stops = {}
    route_meta = {}
    samples = defaultdict(list)
    sources = []

    for path in sorted(latest_feeds()):
        agency = os.path.basename(path).split('_')[0]
        with zipfile.ZipFile(path) as zipped:
            active = active_services(zipped)
            routes = {}
            for row in read_rows(zipped, 'routes.txt'):
                line = (row.get('line_id') or row.get('route_short_name') or row.get('line_short_name') or row['route_id']).strip()
                route_id = f'{agency}:{line}'
                routes[row['route_id']] = route_id
                route_meta[route_id] = {
                    'route_id': route_id,
                    'line': line,
                    'label': (row.get('line_long_name') or row.get('route_long_name') or line).strip(),
                    'mode': agency_group.get(agency, 'other'),
                    'operator': demand['groups'].get(agency_group.get(agency, 'other'), agency),
                }
            active_trips = {
                row['trip_id']: routes[row['route_id']]
                for row in read_rows(zipped, 'trips.txt')
                if row['service_id'] in active and row['route_id'] in routes
            }
            for row in read_rows(zipped, 'stops.txt'):
                if not row.get('stop_lat') or not row.get('stop_lon'):
                    continue
                key = f"{agency}:{row['stop_id']}"
                stops[key] = {
                    'id': key,
                    'name': row['stop_name'].strip(),
                    'lat': float(row['stop_lat']),
                    'lon': float(row['stop_lon']),
                }

            current_trip = None
            visits = []

            def consume(trip_id, trip_visits):
                if not trip_id or len(trip_visits) < 2 or trip_id not in active_trips:
                    return
                route_id = active_trips[trip_id]
                for before, after in zip(trip_visits, trip_visits[1:]):
                    duration = after[1] - before[2] if after[1] is not None and before[2] is not None else None
                    if duration is not None and 0 < duration <= 60 and before[0] != after[0]:
                        samples[(before[0], after[0], route_id)].append(duration)

            for row in stream_rows(zipped, 'stop_times.txt'):
                trip_id = row['trip_id']
                if trip_id != current_trip:
                    consume(current_trip, visits)
                    current_trip, visits = trip_id, []
                key = f"{agency}:{row['stop_id']}"
                if trip_id in active_trips and key in stops:
                    visits.append((key, minute(row.get('arrival_time')), minute(row.get('departure_time'))))
            consume(current_trip, visits)
            sources.append(os.path.basename(path))

    adjacency = defaultdict(list)
    for (origin, destination, route_id), durations in samples.items():
        adjacency[origin].append({
            'kind': 'ride', 'from': origin, 'to': destination,
            'minutes': round(statistics.median(durations), 1),
            **route_meta[route_id],
        })

    cell_size = TRANSFER_RADIUS_M / 110540
    grid = defaultdict(list)
    for stop in stops.values():
        grid[(int(stop['lat'] / cell_size), int(stop['lon'] / cell_size))].append(stop['id'])
    walk = defaultdict(list)
    for stop in stops.values():
        cell = (int(stop['lat'] / cell_size), int(stop['lon'] / cell_size))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for other_id in grid.get((cell[0] + dx, cell[1] + dy), []):
                    if other_id == stop['id']:
                        continue
                    other = stops[other_id]
                    distance = metres(stop['lat'], stop['lon'], other['lat'], other['lon'])
                    if distance <= TRANSFER_RADIUS_M:
                        walk[stop['id']].append({
                            'kind': 'walk', 'from': stop['id'], 'to': other_id,
                            'minutes': max(1, round(distance / WALK_METRES_PER_MINUTE, 1)),
                        })
    return stops, adjacency, walk, sources


def anchor_distances(zone, stops):
    result = {}
    for stop in stops.values():
        distance = metres(zone['lat'], zone['lon'], stop['lat'], stop['lon'])
        if distance <= ANCHOR_RADIUS_M:
            result[stop['id']] = distance / WALK_METRES_PER_MINUTE
    return result


def route(origin_zone, destination_zone, stops, adjacency, walk):
    starts = anchor_distances(origin_zone, stops)
    targets = anchor_distances(destination_zone, stops)
    if not starts or not targets:
        return None
    queue = []
    distances, previous = {}, {}
    for stop_id, access in starts.items():
        state = (stop_id, '', 0)
        distances[state] = access
        heapq.heappush(queue, (access, state))
    winner, winner_cost = None, float('inf')

    while queue:
        cost, state = heapq.heappop(queue)
        if cost != distances.get(state) or cost >= winner_cost:
            continue
        stop_id, current_route, transfers = state
        if stop_id in targets and current_route and transfers >= 1:
            total = cost + targets[stop_id]
            if total < winner_cost:
                winner, winner_cost = state, total
        for edge in adjacency.get(stop_id, []):
            switching = bool(current_route and current_route != edge['route_id'])
            next_transfers = transfers + int(switching)
            if next_transfers > 3:
                continue
            next_state = (edge['to'], edge['route_id'], next_transfers)
            next_cost = cost + edge['minutes'] + (TRANSFER_WAIT if switching else 0)
            if next_cost < distances.get(next_state, float('inf')):
                distances[next_state] = next_cost
                previous[next_state] = (state, edge)
                heapq.heappush(queue, (next_cost, next_state))
        for edge in walk.get(stop_id, []):
            next_state = (edge['to'], current_route, transfers)
            next_cost = cost + edge['minutes']
            if next_cost < distances.get(next_state, float('inf')):
                distances[next_state] = next_cost
                previous[next_state] = (state, edge)
                heapq.heappush(queue, (next_cost, next_state))

    if not winner:
        return None
    edges, cursor = [], winner
    while cursor in previous:
        cursor, edge = previous[cursor]
        edges.append(edge)
    edges.reverse()
    # walking from the origin zone to the first stop and from the last stop to the
    # destination zone; a direct service would need the same walk, so report it
    access_egress = starts[cursor[0]] + targets[winner[0]]
    segments = []
    walk_minutes = 0
    for edge in edges:
        if edge['kind'] == 'walk':
            walk_minutes += edge['minutes']
            continue
        last = segments[-1] if segments else None
        if last and last['route_id'] == edge['route_id']:
            last['to_stop'] = stops[edge['to']]['name']
            last['ride_minutes'] = round(last['ride_minutes'] + edge['minutes'], 1)
        else:
            segments.append({
                'route_id': edge['route_id'], 'line': edge['line'], 'label': edge['label'],
                'mode': edge['mode'], 'operator': edge['operator'],
                'from_stop': stops[edge['from']]['name'], 'to_stop': stops[edge['to']]['name'],
                'ride_minutes': edge['minutes'],
            })
    ride_minutes = round(sum(segment['ride_minutes'] for segment in segments), 1)
    transfers = max(0, len(segments) - 1)
    return {
        'segments': segments,
        'transfers': transfers,
        'scheduled_ride_minutes': ride_minutes,
        'walking_minutes': round(walk_minutes, 1),
        'access_egress_walk_minutes': round(access_egress, 1),
        'assumed_transfer_wait_minutes': transfers * TRANSFER_WAIT,
        'estimated_total_minutes': round(winner_cost, 1),
    }


def main():
    with open(DEMAND_PATH, encoding='utf-8') as handle:
        demand = json.load(handle)
    stops, adjacency, walk, sources = build_graph(demand)
    baselines = {}
    for opportunity in demand['opportunities']:
        key = opportunity['key']
        print(f'route {key}: {demand["zones"][opportunity["a"]]["name"]} -> {demand["zones"][opportunity["b"]]["name"]}')
        baselines[key] = route(
            demand['zones'][opportunity['a']], demand['zones'][opportunity['b']],
            stops, adjacency, walk,
        )
    output = {
        'schema_version': '1.0', 'service_date': SERVICE_DATE.isoformat(),
        'transfer_wait_minutes': TRANSFER_WAIT,
        'method': 'Stop-level GTFS shortest path with nearby-stop walking links; initial wait excluded.',
        'sources': sources, 'routes': baselines,
    }
    with open(OUTPUT, 'w', encoding='utf-8') as handle:
        json.dump(output, handle, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {OUTPUT}: {sum(value is not None for value in baselines.values())}/{len(baselines)} paths resolved')


if __name__ == '__main__':
    main()
