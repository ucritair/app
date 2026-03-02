#!/usr/bin/env python3
"""
Capture all device data + log cells over BLE and save as fixture JSON.

Usage:
    python3 scripts/capture_fixture.py [--output webapp/src/data/fixture_data.json]

Requires:
    pip install bleak

The output JSON matches the FixtureData format expected by the webapp
simulation mode. After capturing, the webapp's fixture.ts will load it.
"""

import argparse
import asyncio
import json
import struct
import sys
from pathlib import Path

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("Error: bleak not installed. Run: pip install bleak")
    sys.exit(1)

# ── BLE UUIDs ──

SERVICE_UUID      = "fc7d4395-1019-49c4-a91b-7491ecc40000"
CHAR_DEVICE_NAME  = "fc7d4395-1019-49c4-a91b-7491ecc40001"
CHAR_TIME         = "fc7d4395-1019-49c4-a91b-7491ecc40002"
CHAR_CELL_COUNT   = "fc7d4395-1019-49c4-a91b-7491ecc40003"
CHAR_CELL_SELECTOR= "fc7d4395-1019-49c4-a91b-7491ecc40004"
CHAR_CELL_DATA    = "fc7d4395-1019-49c4-a91b-7491ecc40005"
CHAR_LOG_STREAM   = "fc7d4395-1019-49c4-a91b-7491ecc40006"
CHAR_STATS        = "fc7d4395-1019-49c4-a91b-7491ecc40010"
CHAR_ITEMS_OWNED  = "fc7d4395-1019-49c4-a91b-7491ecc40011"
CHAR_ITEMS_PLACED = "fc7d4395-1019-49c4-a91b-7491ecc40012"
CHAR_BONUS        = "fc7d4395-1019-49c4-a91b-7491ecc40013"
CHAR_PET_NAME     = "fc7d4395-1019-49c4-a91b-7491ecc40014"
CHAR_DEVICE_CONFIG= "fc7d4395-1019-49c4-a91b-7491ecc40015"

# RTC epoch offset to convert internal RTC timestamps → Unix timestamps
RTC_EPOCH_OFFSET = 59958144000

LOG_STREAM_END_MARKER = 0xFFFFFFFF


# ── Parsers ──

def parse_string(data: bytes) -> str:
    """Parse null-terminated UTF-8 string."""
    end = data.find(0)
    return data[:end].decode("utf-8") if end >= 0 else data.decode("utf-8")


def parse_uint32(data: bytes) -> int:
    return struct.unpack_from("<I", data)[0]


def parse_stats(data: bytes) -> dict:
    """Parse 6-byte pet stats."""
    return {
        "vigour": data[0],
        "focus": data[1],
        "spirit": data[2],
        "age": struct.unpack_from("<H", data, 3)[0],
        "interventions": data[5],
    }


def parse_config(data: bytes) -> dict:
    """Parse 16-byte device config."""
    flags_lo = struct.unpack_from("<I", data, 8)[0]
    flags_hi = struct.unpack_from("<I", data, 12)[0]
    return {
        "sensorWakeupPeriod": struct.unpack_from("<H", data, 0)[0],
        "sleepAfterSeconds": struct.unpack_from("<H", data, 2)[0],
        "dimAfterSeconds": struct.unpack_from("<H", data, 4)[0],
        "noxSamplePeriod": data[6],
        "screenBrightness": data[7],
        "persistFlags": (flags_hi << 32) | flags_lo,
    }


def parse_log_cell(data: bytes) -> dict:
    """Parse 57-byte log cell notification (4-byte cellNumber + 53-byte cell data)."""
    cell_number = struct.unpack_from("<I", data, 0)[0]

    o = 4  # cell data offset
    flags = data[o]

    # timestamp: uint64 LE at offset 4 within cell data
    ts_low = struct.unpack_from("<I", data, o + 4)[0]
    ts_high = struct.unpack_from("<I", data, o + 8)[0]
    rtc_ts = (ts_high << 32) | ts_low
    timestamp = rtc_ts - RTC_EPOCH_OFFSET

    temperature = struct.unpack_from("<i", data, o + 12)[0] / 1000.0
    pressure = struct.unpack_from("<H", data, o + 16)[0] / 10.0
    humidity = struct.unpack_from("<H", data, o + 18)[0] / 100.0
    co2 = struct.unpack_from("<H", data, o + 20)[0]

    pm = [
        struct.unpack_from("<H", data, o + 22)[0] / 100.0,  # PM1.0
        struct.unpack_from("<H", data, o + 24)[0] / 100.0,  # PM2.5
        struct.unpack_from("<H", data, o + 26)[0] / 100.0,  # PM4.0
        struct.unpack_from("<H", data, o + 28)[0] / 100.0,  # PM10
    ]

    pn = [
        struct.unpack_from("<H", data, o + 30)[0] / 100.0,  # PN0.5
        struct.unpack_from("<H", data, o + 32)[0] / 100.0,  # PN1.0
        struct.unpack_from("<H", data, o + 34)[0] / 100.0,  # PN2.5
        struct.unpack_from("<H", data, o + 36)[0] / 100.0,  # PN4.0
        struct.unpack_from("<H", data, o + 38)[0] / 100.0,  # PN10
    ]

    voc = data[o + 40]
    nox = data[o + 41]
    co2_uncomp = struct.unpack_from("<H", data, o + 42)[0]

    mean_time_cong = struct.unpack_from("<f", data, o + 44)[0]
    mean_time_incong = struct.unpack_from("<f", data, o + 48)[0]
    throughput = data[o + 52]

    return {
        "cellNumber": cell_number,
        "flags": flags,
        "timestamp": timestamp,
        "temperature": round(temperature, 3),
        "pressure": round(pressure, 1),
        "humidity": round(humidity, 2),
        "co2": co2,
        "pm": [round(v, 2) for v in pm],
        "pn": [round(v, 2) for v in pn],
        "voc": voc,
        "nox": nox,
        "co2Uncomp": co2_uncomp,
        "stroop": {
            "meanTimeCong": round(mean_time_cong, 2),
            "meanTimeIncong": round(mean_time_incong, 2),
            "throughput": throughput,
        },
    }


# ── Main capture logic ──

async def find_device(timeout: float = 10.0):
    """Scan for a uCrit device advertising the custom service."""
    print(f"Scanning for uCrit device (service {SERVICE_UUID[:8]}...)...")

    # Use return_adv=True to get advertisement data with service UUIDs
    devices = await BleakScanner.discover(timeout=timeout, return_adv=True)

    for address, (device, adv_data) in devices.items():
        # Check advertised service UUIDs
        service_uuids = [str(u).lower() for u in adv_data.service_uuids]
        if SERVICE_UUID.lower() in service_uuids:
            return device
        # Also check by name prefix
        name = adv_data.local_name or device.name
        if name and name.lower().startswith("ucrit"):
            return device

    return None


async def stream_log_cells(client: BleakClient, start: int, count: int) -> list:
    """Stream log cells using the log stream characteristic (notifications)."""
    cells = []
    done_event = asyncio.Event()

    def notification_handler(sender, data: bytearray):
        # Check for end marker
        if len(data) == 4 and struct.unpack_from("<I", data)[0] == LOG_STREAM_END_MARKER:
            done_event.set()
            return

        try:
            cell = parse_log_cell(bytes(data))
            cells.append(cell)
            if len(cells) % 50 == 0:
                print(f"  ... received {len(cells)}/{count} cells")
        except Exception as e:
            print(f"  Warning: failed to parse cell: {e}")

    # Start notifications
    await client.start_notify(CHAR_LOG_STREAM, notification_handler)

    # Write stream command: {start_cell: u32, count: u32}
    cmd = struct.pack("<II", start, count)
    await client.write_gatt_char(CHAR_LOG_STREAM, cmd)
    print(f"  Streaming {count} cells from #{start}...")

    # Wait for end marker or timeout
    try:
        await asyncio.wait_for(done_event.wait(), timeout=max(60, count * 0.5))
    except asyncio.TimeoutError:
        print(f"  Stream timeout — received {len(cells)}/{count} cells")

    await client.stop_notify(CHAR_LOG_STREAM)
    return cells


async def read_cells_individually(client: BleakClient, start: int, count: int) -> list:
    """Fallback: read cells one at a time using selector + read."""
    cells = []
    for i in range(count):
        cell_nr = start + i
        # Write cell selector
        await client.write_gatt_char(
            CHAR_CELL_SELECTOR,
            struct.pack("<I", cell_nr),
        )
        # Read cell data
        data = await client.read_gatt_char(CHAR_CELL_DATA)
        try:
            cell = parse_log_cell(bytes(data))
            cells.append(cell)
        except Exception as e:
            print(f"  Warning: failed to parse cell #{cell_nr}: {e}")

        if (i + 1) % 50 == 0:
            print(f"  ... read {i + 1}/{count} cells")

    return cells


async def capture(output_path: str, use_streaming: bool = True):
    """Connect to device, read everything, save as JSON."""

    # Find device
    device = await find_device()
    if device is None:
        print("No uCrit device found! Make sure it's powered on and nearby.")
        sys.exit(1)

    print(f"Found: {device.name} ({device.address})")
    print(f"Connecting...")

    async with BleakClient(device.address) as client:
        print(f"Connected! Reading device info...")

        # Read all device metadata
        device_name_raw = await client.read_gatt_char(CHAR_DEVICE_NAME)
        device_name = parse_string(bytes(device_name_raw))
        print(f"  Device Name: {device_name}")

        pet_name_raw = await client.read_gatt_char(CHAR_PET_NAME)
        pet_name = parse_string(bytes(pet_name_raw))
        print(f"  Pet Name: {pet_name}")

        time_raw = await client.read_gatt_char(CHAR_TIME)
        device_time = parse_uint32(bytes(time_raw))
        print(f"  Device Time: {device_time}")

        stats_raw = await client.read_gatt_char(CHAR_STATS)
        pet_stats = parse_stats(bytes(stats_raw))
        print(f"  Pet Stats: {pet_stats}")

        config_raw = await client.read_gatt_char(CHAR_DEVICE_CONFIG)
        config = parse_config(bytes(config_raw))
        print(f"  Config: wakeup={config['sensorWakeupPeriod']}s brightness={config['screenBrightness']}")

        items_owned_raw = await client.read_gatt_char(CHAR_ITEMS_OWNED)
        items_owned = list(bytes(items_owned_raw))
        owned_count = sum(bin(b).count("1") for b in items_owned)
        print(f"  Items Owned: {owned_count} items")

        items_placed_raw = await client.read_gatt_char(CHAR_ITEMS_PLACED)
        items_placed = list(bytes(items_placed_raw))
        placed_count = sum(bin(b).count("1") for b in items_placed)
        print(f"  Items Placed: {placed_count} items")

        bonus_raw = await client.read_gatt_char(CHAR_BONUS)
        bonus = parse_uint32(bytes(bonus_raw))
        print(f"  Bonus: {bonus}")

        cell_count_raw = await client.read_gatt_char(CHAR_CELL_COUNT)
        cell_count = parse_uint32(bytes(cell_count_raw))
        print(f"  Cell Count: {cell_count}")

        # Read all log cells
        print(f"\nDownloading {cell_count + 1} log cells...")

        if use_streaming:
            try:
                log_cells = await stream_log_cells(client, 0, cell_count + 1)
            except Exception as e:
                print(f"  Streaming failed ({e}), falling back to individual reads...")
                log_cells = await read_cells_individually(client, 0, cell_count + 1)
        else:
            log_cells = await read_cells_individually(client, 0, cell_count + 1)

        print(f"  Captured {len(log_cells)} log cells")

    # Sort cells by cellNumber
    log_cells.sort(key=lambda c: c["cellNumber"])

    # Build fixture JSON
    fixture = {
        "device": {
            "deviceName": device_name,
            "petName": pet_name,
            "deviceTime": device_time,
            "petStats": pet_stats,
            "config": config,
            "itemsOwned": items_owned,
            "itemsPlaced": items_placed,
            "bonus": bonus,
            "cellCount": cell_count,
        },
        "logCells": log_cells,
    }

    # Write JSON
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as f:
        json.dump(fixture, f, indent=2)

    file_size = output.stat().st_size
    print(f"\nFixture saved to {output} ({file_size:,} bytes)")
    print(f"  {len(log_cells)} log cells, {device_name} / {pet_name}")

    if log_cells:
        first_ts = log_cells[0]["timestamp"]
        last_ts = log_cells[-1]["timestamp"]
        hours = (last_ts - first_ts) / 3600
        print(f"  Time span: {hours:.1f} hours")


def main():
    parser = argparse.ArgumentParser(description="Capture uCrit device data as fixture JSON")
    parser.add_argument(
        "--output", "-o",
        default="webapp/src/data/fixture_data.json",
        help="Output JSON file path (default: webapp/src/data/fixture_data.json)",
    )
    parser.add_argument(
        "--no-stream",
        action="store_true",
        help="Read cells individually instead of using streaming (slower but more reliable)",
    )
    args = parser.parse_args()

    asyncio.run(capture(args.output, use_streaming=not args.no_stream))


if __name__ == "__main__":
    main()
