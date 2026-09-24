"""Aggregate TML validations + GTFS supply into src/data/demand.json.

Usage: python3 scripts/build_demand_json.py [validations_dir]

Everything is bucketed into 30-minute slots in Lisbon time. Only slots fully
covered by the validation files are kept, so the time slider never shows a
half-empty slot as a drop in demand.

GTFS plans in force during the sample are downloaded from the public TML plans
API and cached in scripts/.gtfs_cache.
"""
import collections
import csv
import glob
import io
import json
import math
import os
import re
import sys
import urllib.request
import zipfile
from bisect import bisect_left
from datetime import datetime, timedelta, timezone
from itertools import combinations

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALIDATIONS_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    '~/Downloads/_datasets/TML/validations/validations')
CACHE = os.path.join(ROOT, 'scripts', '.gtfs_cache', 'zips')
OUT = os.path.join(ROOT, 'src', 'data', 'demand.json')

LISBON = timezone(timedelta(hours=1))  # WEST, valid for the Aug/Sep sample
SLOT_MIN = 30

GROUP = {
    'IA2N9': 'metro',
    'IA9T6': 'carris',
    'LA77N': 'cm', 'BNA17': 'cm', 'YA15B': 'cm', 'A2L1N': 'cm',
    'HF16N': 'other', 'LTP61': 'other', '7NTB1': 'other', 'N18KL': 'other',
}
GROUP_KEYS = ['metro', 'carris', 'cm', 'other']
ENTRY = {'1', '3', '13'}
EXIT = {'4', '14'}
METRO_LINES = {'A': 'Azul', 'B': 'Amarela', 'C': 'Verde', 'D': 'Vermelha'}
MUNICIPALITY = {
    '1105': 'Cascais', '1106': 'Lisboa', '1107': 'Loures', '1109': 'Mafra', '1110': 'Oeiras',
    '1111': 'Sintra', '1114': 'Vila Franca de Xira', '1115': 'Amadora', '1116': 'Odivelas',
    '1502': 'Alcochete', '1503': 'Almada', '1504': 'Barreiro', '1506': 'Moita', '1507': 'Montijo',
    '1508': 'Palmela', '1510': 'Seixal', '1511': 'Sesimbra', '1512': 'Setúbal',
}

TOP_STOPS = 500
BUCKET_STOPS = 100
TOP_LINES = 40
N_ZONES = 45
FLOWS_PER_SLOT = 150
MIN_FLOW = 3
MIN_OPPORTUNITY_FLOW = 75
MIN_OPPORTUNITY_DAYS = 3
MAX_OPPORTUNITIES = 16
STRONG_WINDOW_MS = 60 * 60 * 1000
WEAK_WINDOW_MS = 14 * 60 * 60 * 1000
METRO_TRIP_MAX_MS = 120 * 60 * 1000


# ---------------------------------------------------------------- GTFS

def plans_for_sample(first_day, last_day):
    plans = json.load(urllib.request.urlopen(
        'https://go.tmlmobilidade.pt/hub/api/v1/plans', timeout=60))['data']
    lo, hi = int(first_day.strftime('%Y%m%d')), int(last_day.strftime('%Y%m%d'))
    return [p for p in plans if p['agency_id'] in GROUP
            and p['active_from'] <= hi and p['active_until'] >= lo]


def open_plan(plan):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{plan['agency_id']}_{plan['active_from']}.zip")
    if not os.path.exists(path):
        urllib.request.urlretrieve(plan['operation_gtfs_normalized_url'], path)
    return zipfile.ZipFile(path)


def read_csv(z, name):
    if name not in z.namelist():
        return
    with z.open(name) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding='utf-8-sig'))


def active_services(z, day):
    """service_ids running on `day`, from calendar.txt + calendar_dates.txt."""
    ymd = day.strftime('%Y%m%d')
    weekday = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][day.weekday()]
    active = set()
    for r in read_csv(z, 'calendar.txt'):
        if r['start_date'] <= ymd <= r['end_date'] and r[weekday] == '1':
            active.add(r['service_id'])
    for r in read_csv(z, 'calendar_dates.txt'):
        if r['date'] == ymd:
            (active.add if r['exception_type'] == '1' else active.discard)(r['service_id'])
    return active


def load_gtfs(plans):
    stops, lines = {}, {}
    service_patterns = collections.defaultdict(set)
    for plan in plans:
        agency, z = plan['agency_id'], open_plan(plan)
        for r in read_csv(z, 'stops.txt'):
            if r.get('stop_lat') and r.get('stop_lon'):
                muni = (r.get('municipality_id') or r.get('municipality') or '').split(' ')[0]
                stops.setdefault((agency, r['stop_id']), (
                    r['stop_name'].strip(), float(r['stop_lat']), float(r['stop_lon']), muni))
        for r in read_csv(z, 'routes.txt'):
            name = (r.get('line_long_name') or r.get('route_long_name') or '').strip()
            for key in (r.get('line_id'), r.get('route_short_name'), r.get('line_short_name')):
                if key:
                    lines.setdefault((agency, key.strip()), name)
        route_line = {}
        for r in read_csv(z, 'routes.txt'):
            line = (r.get('line_id') or r.get('route_short_name') or r.get('line_short_name') or r['route_id']).strip()
            route_line[r['route_id']] = line
        trip_route = {r['trip_id']: r['route_id'] for r in read_csv(z, 'trips.txt')}
        trip_stops = collections.defaultdict(set)
        for r in read_csv(z, 'stop_times.txt'):
            if r['trip_id'] in trip_route:
                trip_stops[r['trip_id']].add(r['stop_id'])
        for trip_id, stop_ids in trip_stops.items():
            route_id = trip_route[trip_id]
            service_patterns[(agency, route_line[route_id])].add(frozenset(stop_ids))
    return stops, lines, service_patterns


def scheduled_departures(plans, days, slot_by_minute, stop_key_of):
    """Count scheduled stop departures per (stop key, slot index)."""
    dep = collections.Counter()
    departure_minutes = collections.defaultdict(collections.Counter)
    for plan in plans:
        agency, z = plan['agency_id'], open_plan(plan)
        plan_days = [d for d in days if plan['active_from'] <= int(d.strftime('%Y%m%d')) <= plan['active_until']]
        if not plan_days:
            continue
        services = {d: active_services(z, d) for d in plan_days}
        trip_days = collections.defaultdict(list)
        for r in read_csv(z, 'trips.txt'):
            for d in plan_days:
                if r['service_id'] in services[d]:
                    trip_days[r['trip_id']].append(d)
        with z.open('stop_times.txt') as fh:
            reader = csv.reader(io.TextIOWrapper(fh, encoding='utf-8-sig'))
            header = next(reader)
            i_trip, i_dep, i_stop = header.index('trip_id'), header.index('departure_time'), header.index('stop_id')
            for row in reader:
                ds = trip_days.get(row[i_trip])
                if not ds or not row[i_dep]:
                    continue
                h, m, _ = row[i_dep].split(':')
                minute = int(h) * 60 + int(m)  # may pass 24:00 on the service day
                key = None
                for d in ds:
                    absolute = d.toordinal() * 1440 + minute
                    slot = slot_by_minute.get(absolute - absolute % SLOT_MIN)
                    if slot is not None:
                        key = key or stop_key_of(agency, row[i_stop])
                        dep[(key, slot)] += 1
                        departure_minutes[key][absolute] += 1
        print(f'  supply {agency} {plan["active_from"]}: {len(trip_days)} trips on sample days')
    return dep, departure_minutes


# ---------------------------------------------------------------- helpers

def validation_stop(agency, stop_id):
    # Transtejo validations use 2100NN where the GTFS stop_id is NN
    if agency == 'LTP61' and stop_id.startswith('2100'):
        return agency, str(int(stop_id) - 210000)
    return agency, stop_id


def floor_slot(t):
    return t.replace(minute=t.minute - t.minute % SLOT_MIN, second=0, microsecond=0)


def tidy(name):
    name = re.sub(r'\s+P\d+\b.*$', '', name.strip())  # platform suffixes: "P9 Entrada Sul"
    letters = [c for c in name if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.7:
        name = name.title()
    return name


HUB_WORDS = re.compile(r'esta[cç][aã]o|terminal|interface|cais|metro|fluvial', re.I)


def distance_m(lat1, lon1, lat2, lon2):
    dx = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110540
    return math.hypot(dx, dy)


def build_stop_areas(stops, radius_m=400):
    """Group an operator's same-named stops within `radius_m` into one stop area.

    Interchanges often record validations on one stop_id while vehicles depart
    from its neighbours, so demand and supply only line up at area level.
    """
    by_name = collections.defaultdict(list)
    for (agency, sid), (name, lat, lon, _) in stops.items():
        by_name[(agency, tidy(name))].append((sid, lat, lon))
    area = {}
    for (agency, name), members in by_name.items():
        centers = []
        for sid, lat, lon in members:
            ci = next((i for i, (clat, clon) in enumerate(centers) if distance_m(lat, lon, clat, clon) < radius_m), None)
            if ci is None:
                centers.append((lat, lon))
                ci = len(centers) - 1
            area[(agency, sid)] = (agency, name if ci == 0 else f'{name}#{ci}')
    return area


def kmeans(points, k, iters=25):
    """Weighted k-means on (x, y, w). Seeds are the heaviest points at least ~1.5 km apart."""
    seeds = []
    for x, y, w in sorted(points, key=lambda p: -p[2]):
        if all((x - sx) ** 2 + (y - sy) ** 2 > 1.5 ** 2 for sx, sy in seeds):
            seeds.append((x, y))
        if len(seeds) == k:
            break
    centers = seeds
    for _ in range(iters):
        acc = [[0.0, 0.0, 0.0] for _ in centers]
        for x, y, w in points:
            i = min(range(len(centers)), key=lambda c: (x - centers[c][0]) ** 2 + (y - centers[c][1]) ** 2)
            acc[i][0] += x * w
            acc[i][1] += y * w
            acc[i][2] += w
        centers = [(a[0] / a[2], a[1] / a[2]) if a[2] else centers[i] for i, a in enumerate(acc)]
    return centers


# ---------------------------------------------------------------- main

def main():
    files = sorted(glob.glob(os.path.join(VALIDATIONS_DIR, '*.csv')))

    # Pass 1: coverage window of each file -> fully covered slots
    windows = []
    for path in files:
        lo = hi = None
        with open(path, newline='') as fh:
            reader = csv.reader(fh)
            i_ts = next(reader).index('created_at')
            for row in reader:
                ts = int(row[i_ts])
                lo = ts if lo is None or ts < lo else lo
                hi = ts if hi is None or ts > hi else hi
        windows.append((datetime.fromtimestamp(lo / 1000, LISBON), datetime.fromtimestamp(hi / 1000, LISBON)))
    slot_starts = []
    for w, (lo, hi) in enumerate(windows):
        t = floor_slot(lo) + timedelta(minutes=SLOT_MIN)  # skip the partial first slot
        while t + timedelta(minutes=SLOT_MIN) <= floor_slot(hi):  # and the partial last one
            slot_starts.append((t, w))
            t += timedelta(minutes=SLOT_MIN)
    slot_index = {t: i for i, (t, _) in enumerate(slot_starts)}
    n_slots = len(slot_starts)

    def slot_of(t):
        return slot_index.get(floor_slot(t))

    days = sorted({t.date() for t, _ in slot_starts})
    plans = plans_for_sample(days[0], days[-1])
    stops, line_names, service_patterns = load_gtfs(plans)

    # Platforms, entrances and same-named stops around an interchange become one stop area
    area_of = build_stop_areas(stops)

    def stop_key_of(agency, stop_id):
        key = validation_stop(agency, stop_id)
        return area_of.get(key, key)

    positions = collections.defaultdict(list)
    for (agency, sid), (name, lat, lon, muni) in stops.items():
        positions[stop_key_of(agency, sid)].append((lat, lon, name, muni))

    # Pass 2: validations
    stop_in = collections.defaultdict(lambda: [0] * n_slots)
    stop_minutes = collections.defaultdict(collections.Counter)
    stop_out = collections.defaultdict(lambda: [0] * n_slots)
    stop_lines = collections.defaultdict(collections.Counter)
    line_slots = collections.defaultdict(lambda: [0] * n_slots)
    totals = {g: [0] * n_slots for g in GROUP_KEYS}
    cards = collections.defaultdict(list)
    n_rows = n_entries = 0

    for path in files:
        with open(path, newline='') as fh:
            for r in csv.DictReader(fh):
                agency = r['agency_id']
                group = GROUP.get(agency)
                if group is None:
                    continue
                n_rows += 1
                ts = int(r['created_at'])
                event_time = datetime.fromtimestamp(ts / 1000, LISBON)
                slot = slot_of(event_time)
                key = stop_key_of(agency, r['stop_id'])
                ev = r['event_type']
                if ev in ENTRY:
                    n_entries += 1
                    cards[r['card_serial_number_hash']].append((ts, 1, group, r['line_id'], key, slot))
                    if slot is None:
                        continue
                    totals[group][slot] += 1
                    stop_in[key][slot] += 1
                    absolute_minute = event_time.date().toordinal() * 1440 + event_time.hour * 60 + event_time.minute
                    stop_minutes[key][absolute_minute] += 1
                    stop_lines[key][r['line_id']] += 1
                    line_slots[(agency, r['line_id'])][slot] += 1
                elif ev in EXIT and agency == 'IA2N9':
                    cards[r['card_serial_number_hash']].append((ts, 0, group, r['line_id'], key, slot))
                    if slot is not None:
                        stop_out[key][slot] += 1

    # Zones for the flow map: weighted k-means over mapped stops
    stop_total = {k: sum(v) for k, v in stop_in.items() if k in positions}
    km = 111.0
    coslat = math.cos(math.radians(38.72))

    def xy(lat, lon):
        return lon * km * coslat, lat * km

    def centroid(key):
        pts = positions[key]
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)

    pts = [(*xy(*centroid(k)), n) for k, n in stop_total.items() if n > 0]
    centers = kmeans(pts, N_ZONES)
    zone_of = {}
    for key in positions:
        x, y = xy(*centroid(key))
        zone_of[key] = min(range(len(centers)), key=lambda c: (x - centers[c][0]) ** 2 + (y - centers[c][1]) ** 2)
    # Name each zone after its busiest recognisable hub (station, terminal, pier),
    # falling back to its busiest stop
    by_zone = collections.defaultdict(list)
    for key, n in stop_total.items():
        by_zone[zone_of[key]].append((n, key))
    zone_best = {}
    for z, members in by_zone.items():
        members.sort(reverse=True)
        top_n = members[0][0]
        hub = next((m for m in members if m[0] >= 0.25 * top_n and (
            m[1][0] in ('IA2N9', 'LTP61', '7NTB1') or HUB_WORDS.search(positions[m[1]][0][2]))), members[0])
        zone_best[z] = (hub[1], hub[0])
    zones = []
    for i, (x, y) in enumerate(centers):
        key = zone_best.get(i, (None, 0))[0]
        name = tidy(positions[key][0][2]) if key else f'Zone {i + 1}'
        muni = MUNICIPALITY.get(positions[key][0][3], '') if key else ''
        zones.append({'id': i, 'name': name, 'area': muni,
                      'lat': round(y / km, 5), 'lon': round(x / (km * coslat), 5)})

    # A pair is directly served only when at least one actual GTFS trip pattern
    # visits both zones. This is stricter than sharing an operator or route name.
    served_pairs = set()
    for (agency, _), patterns in service_patterns.items():
        for pattern in patterns:
            pattern_zones = {
                zone_of[key] for sid in pattern
                if (key := stop_key_of(agency, sid)) in zone_of
            }
            served_pairs.update(combinations(sorted(pattern_zones), 2))

    # Flow legs from each card's day, attributed to the origin tap's slot
    # conf 0 = observed (Metro entry->exit), 1 = strongly inferred (next boarding
    # within 60 min), 2 = weakly inferred (next boarding later the same day)
    flows = [collections.Counter() for _ in range(n_slots)]
    leg_counts = [0, 0, 0]
    transfers = 0
    group_transfers = collections.Counter()
    metro_od = collections.Counter()
    journey_paths = collections.Counter()
    for events in cards.values():
        events.sort()
        taps = [(i, e) for i, e in enumerate(events) if e[1]]
        for (_, x), (_, y) in zip(taps, taps[1:]):
            if y[0] - x[0] <= STRONG_WINDOW_MS and (x[2], x[3]) != (y[2], y[3]):
                group_transfers[(x[2], y[2])] += 1
        # Four-layer journeys: origin mode -> transfer hub -> next mode ->
        # destination zone. The last leg is observed for a Metro exit or
        # strongly inferred from the following boarding.
        for tap_i, ((_, x), (event_i, y)) in enumerate(zip(taps, taps[1:])):
            if y[0] - x[0] > STRONG_WINDOW_MS or (x[2], x[3]) == (y[2], y[3]):
                continue
            dest = evidence = None
            next_event = events[event_i + 1] if event_i + 1 < len(events) else None
            if y[2] == 'metro' and next_event and not next_event[1] and next_event[0] - y[0] <= METRO_TRIP_MAX_MS:
                dest, evidence = next_event[4], 0
            elif tap_i + 2 < len(taps):
                z = taps[tap_i + 2][1]
                if z[0] - y[0] <= STRONG_WINDOW_MS and (y[2], y[3]) != (z[2], z[3]):
                    dest, evidence = z[4], 1
            hub_zone = zone_of.get(y[4])
            dest_zone = zone_of.get(dest) if dest else None
            if hub_zone is not None and dest_zone is not None and hub_zone != dest_zone:
                journey_paths[(x[2], hub_zone, y[2], dest_zone, evidence)] += 1
        for i, (ts, is_in, group, line, key, slot) in enumerate(events):
            if not is_in:
                continue
            nxt = events[i + 1] if i + 1 < len(events) else None
            conf = dest = None
            if group == 'metro' and nxt and not nxt[1] and nxt[0] - ts <= METRO_TRIP_MAX_MS:
                conf, dest = 0, nxt[4]
                if key != dest:
                    metro_od[(key[1], dest[1])] += 1
            else:
                j = i + 1
                while j < len(events) and not events[j][1]:
                    j += 1
                if j < len(events):
                    gap = events[j][0] - ts
                    if gap <= STRONG_WINDOW_MS and (events[j][2], events[j][3]) != (group, line):
                        conf, dest = 1, events[j][4]
                        transfers += 1
                    elif STRONG_WINDOW_MS < gap <= WEAK_WINDOW_MS:
                        conf, dest = 2, events[j][4]
            if conf is None or slot is None:
                continue
            a, b = zone_of.get(key), zone_of.get(dest)
            if a is None or b is None or a == b:
                continue
            flows[slot][(a, b, conf)] += 1
            leg_counts[conf] += 1
    flow_out = [[[a, b, n, c] for (a, b, c), n in f.most_common(FLOWS_PER_SLOT) if n >= MIN_FLOW] for f in flows]

    # Rank recurring flows which lack a one-seat service in the in-force GTFS.
    # Only observed and strongly inferred legs count; weak same-day inference is
    # deliberately excluded from planning recommendations.
    opportunities = collections.defaultdict(lambda: {
        'directions': collections.Counter(), 'confidence': [0, 0],
        'days': set(), 'series': [0] * n_slots,
    })
    for slot, slot_flows in enumerate(flows):
        day = slot_starts[slot][0].date().isoformat()
        for (a, b, conf), n in slot_flows.items():
            if conf > 1 or a == b:
                continue
            pair = tuple(sorted((a, b)))
            item = opportunities[pair]
            item['directions'][(a, b)] += n
            item['confidence'][conf] += n
            item['days'].add(day)
            item['series'][slot] += n

    opportunity_out = []
    for (a, b), item in opportunities.items():
        total = sum(item['confidence'])
        days_seen = len(item['days'])
        if ((a, b) in served_pairs or total < MIN_OPPORTUNITY_FLOW
                or days_seen < MIN_OPPORTUNITY_DAYS):
            continue
        ab = item['directions'][(a, b)]
        ba = item['directions'][(b, a)]
        balance = min(ab, ba) / max(ab, ba) if max(ab, ba) else 0
        distance = distance_m(zones[a]['lat'], zones[a]['lon'], zones[b]['lat'], zones[b]['lon']) / 1000
        # Demand drives the rank; recurrence and two-way use raise confidence.
        score = total * (0.7 + 0.06 * days_seen) * (0.75 + 0.25 * balance)
        opportunity_out.append({
            'key': f'{a}-{b}', 'a': a, 'b': b, 'n': total,
            'ab': ab, 'ba': ba, 'days': days_seen,
            'distanceKm': round(distance, 1), 'balance': round(balance, 3),
            'byConf': item['confidence'], 'series': item['series'],
            'score': round(score),
        })
    opportunity_out.sort(key=lambda x: (-x['score'], -x['n']))
    opportunity_out = opportunity_out[:MAX_OPPORTUNITIES]

    # Supply: scheduled departures per stop per slot
    print('computing scheduled supply...')
    slot_by_minute = {t.date().toordinal() * 1440 + t.hour * 60 + t.minute: i for i, (t, _) in enumerate(slot_starts)}
    dep, departure_minutes = scheduled_departures(plans, days, slot_by_minute, stop_key_of)

    # Stops (top N by boardings)
    out_stops = []
    top = sorted(stop_total.items(), key=lambda kv: -kv[1])[:TOP_STOPS]
    for rank, (key, n) in enumerate(top):
        agency, sid = key
        lat, lon = centroid(key)
        name, muni = positions[key][0][2], positions[key][0][3]
        lines = [f'Linha {METRO_LINES.get(l, l)}' if agency == 'IA2N9' else l
                 for l, _ in stop_lines[key].most_common(4)]
        s = {
            'id': f'{agency}:{sid}',
            'name': tidy(name),
            'area': MUNICIPALITY.get(muni, ''),
            'group': GROUP[agency],
            'lat': round(lat, 5), 'lon': round(lon, 5),
            'zone': zone_of[key],
            'lines': lines,
            'in': stop_in[key],
        }
        if agency == 'IA2N9':
            s['out'] = stop_out[key]
        supply = [dep.get((key, i), 0) for i in range(n_slots)]
        if any(supply):
            s['dep'] = supply
        if any(supply) and rank < BUCKET_STOPS:
            buckets = [[] for _ in range(n_slots)]
            validation_counts = stop_minutes[key]
            validation_times = sorted(validation_counts)
            prefix = [0]
            for minute in validation_times:
                prefix.append(prefix[-1] + validation_counts[minute])

            def validations_between(start, end):
                left = bisect_left(validation_times, start)
                right = bisect_left(validation_times, end)
                return prefix[right] - prefix[left]

            previous_by_window = {}
            for minute, n_departures in sorted(departure_minutes[key].items()):
                slot = slot_by_minute.get(minute - minute % SLOT_MIN)
                if slot is None:
                    continue
                window = slot_starts[slot][1]
                previous = previous_by_window.get(window)
                buckets[slot].append([
                    minute % 1440,
                    n_departures,
                    validations_between(previous, minute) if previous is not None else None,
                    minute - previous if previous is not None else None,
                ])
                previous_by_window[window] = minute
            s['buckets'] = buckets
        out_stops.append(s)

    out_lines = []
    for (agency, line_id), series in sorted(line_slots.items(), key=lambda kv: -sum(kv[1]))[:TOP_LINES]:
        label = f'Linha {METRO_LINES[line_id]}' if agency == 'IA2N9' else line_id
        name = 'Metro' if agency == 'IA2N9' else line_names.get((agency, line_id[2:] if line_id.startswith('TT') else line_id), '')
        out_lines.append({'group': GROUP[agency], 'line': label, 'name': name, 'n': series})

    out = {
        'meta': {
            'validations': n_rows,
            'entries': n_entries,
            'cards': len(cards),
            'transfers': transfers,
            'legs': {'observed': leg_counts[0], 'strong': leg_counts[1], 'weak': leg_counts[2]},
            'files': [os.path.basename(f) for f in files],
            'slotMinutes': SLOT_MIN,
            'windows': [[lo.isoformat(timespec='minutes'), hi.isoformat(timespec='minutes')] for lo, hi in windows],
        },
        'groups': {
            'metro': 'Metropolitano de Lisboa',
            'carris': 'Carris',
            'cm': 'Carris Metropolitana',
            'other': 'MobiCascais, Transtejo Soflusa, Fertagus, CP',
        },
        'slots': [{'t': t.strftime('%Y-%m-%dT%H:%M'), 'w': w} for t, w in slot_starts],
        'totals': totals,
        'stops': out_stops,
        'lines': out_lines,
        'zones': zones,
        'flows': flow_out,
        'opportunities': opportunity_out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {OUT} ({os.path.getsize(OUT) // 1024} KB), {n_slots} slots, {len(out_stops)} stops')

    write_overview(slot_starts, totals, stop_total, positions, centroid, line_slots, line_names,
                   group_transfers, metro_od, journey_paths, zones, n_entries, len(cards))


def write_overview(slot_starts, totals, stop_total, positions, centroid, line_slots, line_names,
                   group_transfers, metro_od, journey_paths, zones, n_entries, n_cards):
    """Static whole-sample aggregates for the Overview page."""
    # Average boardings per clock hour, using hours where both half-hours are covered
    halves = collections.defaultdict(dict)
    for i, (t, _) in enumerate(slot_starts):
        halves[(t.date(), t.hour)][t.minute] = i
    per_hour = collections.defaultdict(list)
    for (day, hour), idx in halves.items():
        if len(idx) == 2:
            per_hour[hour].append({g: sum(totals[g][i] for i in idx.values()) for g in GROUP_KEYS})
    hourly = []
    for hour in range(24):
        samples = per_hour.get(hour, [])
        row = {'hour': hour, 'samples': len(samples)}
        for g in GROUP_KEYS:
            row[g] = round(sum(x[g] for x in samples) / len(samples)) if samples else None
        hourly.append(row)

    stops_out = []
    for key, n in sorted(stop_total.items(), key=lambda kv: -kv[1])[:600]:
        lat, lon = centroid(key)
        stops_out.append({'id': f'{key[0]}:{key[1]}', 'name': tidy(positions[key][0][2]), 'group': GROUP[key[0]],
                          'lat': round(lat, 5), 'lon': round(lon, 5), 'n': n})

    by_group = collections.defaultdict(list)
    for (agency, line_id), series in sorted(line_slots.items(), key=lambda kv: -sum(kv[1])):
        by_group[GROUP[agency]].append((agency, line_id, sum(series)))
    lines_out = []
    for group, rows in by_group.items():
        for agency, line_id, n in rows[:12]:
            if agency == 'IA2N9':
                label, name = f'Linha {METRO_LINES[line_id]}', 'Metro'
            else:
                label = line_id
                name = line_names.get((agency, line_id[2:] if line_id.startswith('TT') else line_id), '')
            lines_out.append({'group': group, 'line': label, 'name': name, 'n': n})

    overview = {
        'meta': {
            'entries': n_entries,
            'cards': n_cards,
            'transfers': sum(group_transfers.values()),
            'transferWindowMin': STRONG_WINDOW_MS // 60000,
        },
        'hourly': hourly,
        'stops': stops_out,
        'lines': lines_out,
        'flows': [{'from': a, 'to': b, 'n': n} for (a, b), n in group_transfers.most_common()],
        'metroOD': [{'from': a, 'to': b, 'n': n} for (a, b), n in metro_od.most_common(12)],
        'journeyLayers': [
            {
                'from': origin_group,
                'hub': hub,
                'hubName': zones[hub]['name'],
                'via': next_group,
                'to': destination,
                'toName': zones[destination]['name'],
                'confidence': evidence,
                'n': n,
            }
            for (origin_group, hub, next_group, destination, evidence), n
            in journey_paths.most_common(250)
        ],
    }
    path = os.path.join(os.path.dirname(OUT), 'overview.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(overview, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {path} ({os.path.getsize(path) // 1024} KB)')


if __name__ == '__main__':
    main()
