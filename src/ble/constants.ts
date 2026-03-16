// Custom vendor service
export const CUSTOM_SERVICE_UUID = 'fc7d4395-1019-49c4-a91b-7491ecc40000';
export const DEVICE_NAME_PREFIX = 'uCrit';

// Helper to build full 128-bit UUID from 16-bit suffix
function vndUuid(suffix: number): string {
  return `fc7d4395-1019-49c4-a91b-7491ecc4${suffix.toString(16).padStart(4, '0')}`;
}

// Custom service characteristics
export const CHAR_DEVICE_NAME   = vndUuid(0x0001);
export const CHAR_TIME          = vndUuid(0x0002);
export const CHAR_CELL_COUNT    = vndUuid(0x0003);
export const CHAR_CELL_SELECTOR = vndUuid(0x0004);
export const CHAR_CELL_DATA     = vndUuid(0x0005);
export const CHAR_LOG_STREAM    = vndUuid(0x0006);
export const CHAR_STATS         = vndUuid(0x0010);
export const CHAR_ITEMS_OWNED   = vndUuid(0x0011);
export const CHAR_ITEMS_PLACED  = vndUuid(0x0012);
export const CHAR_BONUS         = vndUuid(0x0013);
export const CHAR_PET_NAME      = vndUuid(0x0014);
export const CHAR_DEVICE_CONFIG = vndUuid(0x0015);

// Environmental Sensing Service (ESS)
export const ESS_SERVICE_UUID = '0000181a-0000-1000-8000-00805f9b34fb';

export const ESS_TEMPERATURE = '00002a6e-0000-1000-8000-00805f9b34fb';
export const ESS_HUMIDITY    = '00002a6f-0000-1000-8000-00805f9b34fb';
export const ESS_PRESSURE    = '00002a6d-0000-1000-8000-00805f9b34fb';
export const ESS_CO2         = '00002b8c-0000-1000-8000-00805f9b34fb';
export const ESS_PM2_5       = '00002bd6-0000-1000-8000-00805f9b34fb';
export const ESS_PM1_0       = '00002bd5-0000-1000-8000-00805f9b34fb';
export const ESS_PM10        = '00002bd7-0000-1000-8000-00805f9b34fb';

// RTC epoch offset used to convert log cell timestamps to Unix time
// cell.timestamp is in "internal RTC seconds" — subtract this to get Unix seconds
export const RTC_EPOCH_TIME_OFFSET = 59958144000n;

// Log cell BLE payload size (64-byte struct minus 11-byte pad)
export const LOG_CELL_BLE_SIZE = 53;
// Full notification: 4-byte cell_nr + 53-byte cell data
export const LOG_CELL_NOTIFICATION_SIZE = 57;
// End marker for log streaming
export const LOG_STREAM_END_MARKER = 0xFFFFFFFF;
