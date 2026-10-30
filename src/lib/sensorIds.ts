/**
 * ArduPilot sensor device ids (`COMPASS_DEV_ID`, `INS_ACC_ID`, …): bus type, bus, address and driver type packed in 24 bits.
 * Layout and driver tables from AP_HAL/Device.h, AP_Compass_Backend.h and AP_InertialSensor_Backend.h.
 */

const BUS = ["", "I2C", "SPI", "DroneCAN", "SITL", "MSP", "Serial", "WSPI"];

const COMPASS_TYPES: Record<number, string> = {
  0x01: "HMC5883", 0x02: "LSM303D", 0x04: "AK8963", 0x05: "BMM150", 0x06: "LSM9DS1", 0x07: "HMC5883",
  0x08: "LIS3MDL", 0x09: "AK09916", 0x0a: "IST8310", 0x0b: "ICM-20948", 0x0c: "MMC3416", 0x0d: "QMC5883L",
  0x0e: "MAG3110", 0x0f: "SITL", 0x10: "IST8308", 0x11: "RM3100", 0x12: "RM3100", 0x13: "MMC5983",
  0x14: "AK09918", 0x15: "AK09915", 0x16: "QMC5883P", 0x17: "BMM350", 0x18: "IIS2MDC", 0x1a: "AF9838",
};

const IMU_TYPES: Record<number, string> = {
  0x09: "BMI160", 0x10: "L3G4200D", 0x11: "LSM303D", 0x12: "BMA180", 0x13: "MPU-6000", 0x16: "MPU-9250",
  0x17: "IIS328DQ", 0x18: "LSM9DS1", 0x21: "MPU-6000", 0x22: "L3GD20", 0x24: "MPU-9250", 0x25: "I3G4250D",
  0x26: "LSM9DS1", 0x27: "ICM-20789", 0x28: "ICM-20689", 0x29: "BMI055", 0x2a: "SITL", 0x2b: "BMI088",
  0x2c: "ICM-20948", 0x2d: "ICM-20648", 0x2e: "ICM-20649", 0x2f: "ICM-20602", 0x30: "ICM-20601",
  0x31: "ADIS1647x", 0x32: "Serial IMU", 0x33: "ICM-40609", 0x34: "ICM-42688", 0x35: "ICM-42605",
  0x36: "ICM-40605", 0x37: "IIM-42652", 0x38: "BMI270", 0x39: "BMI085", 0x3a: "ICM-42670", 0x3b: "ICM-45686",
  0x3c: "SCHA63T", 0x3d: "IIM-42653", 0x3e: "LSM6DSV16X", 0x3f: "ASM330", 0x40: "ADIS16607", 0x41: "SCH16T",
  0x42: "LSM6DSV32X", 0x43: "LSM6DSK320X", 0x44: "ICM-56686",
};

export type Device = { name: string; bus: string; where: string };

/** Name and bus of a sensor, or null for an empty id. `where` reads like "I2C 2 · 0x20". */
export function describeDevice(id: number | null, kind: "compass" | "imu"): Device | null {
  if (id == null || id <= 0) return null;
  const busType = id & 0x07;
  const bus = (id >> 3) & 0x1f;
  const address = (id >> 8) & 0xff;
  const devtype = (id >> 16) & 0xff;
  const table = kind === "compass" ? COMPASS_TYPES : IMU_TYPES;
  const name = table[devtype] ?? (busType === 3 ? "DroneCAN" : `Type ${devtype}`);
  const busName = BUS[busType] ?? "";
  let where = busName;
  if (busType === 1) where = `I2C ${bus} · 0x${address.toString(16).padStart(2, "0")}`;
  else if (busType === 2) where = `SPI ${bus}`;
  else if (busType === 3) where = `DroneCAN ${bus + 1} · node ${address}`;
  return { name, bus: busName, where };
}

/** COMPASS_DISBLMSK bits and their names, as AP_Compass documents them. */
export const COMPASS_DRIVER_BITS: Record<number, string> = {
  0: "HMC5883", 1: "LSM303D", 2: "AK8963", 3: "BMM150", 4: "LSM9DS1", 5: "LIS3MDL", 6: "AK0991x", 7: "IST8310",
  8: "ICM-20948", 9: "MMC3416", 11: "DroneCAN", 12: "QMC5883L", 14: "MAG3110", 15: "IST8308", 16: "RM3100", 17: "MSP",
  18: "External AHRS", 19: "MMC5xx3", 20: "QMC5883P", 21: "BMM350", 22: "IIS2MDC / LIS2MDL", 24: "AF9838",
};

/** Compass device type (from the id) → its AP_Compass driver bit; DroneCAN and MSP go by bus. */
const COMPASS_TYPE_BIT: Record<number, number> = {
  0x01: 0, 0x07: 0, 0x02: 1, 0x04: 2, 0x05: 3, 0x06: 4, 0x08: 5, 0x09: 6, 0x14: 6, 0x15: 6, 0x0a: 7, 0x0b: 8,
  0x0c: 9, 0x0d: 12, 0x0e: 14, 0x10: 15, 0x11: 16, 0x12: 16, 0x13: 19, 0x16: 20, 0x17: 21, 0x18: 22, 0x1a: 24,
};

/** The COMPASS_DISBLMSK bit that stops this compass's driver, or null when it has none (SITL). */
export function compassDriverBit(id: number | null): number | null {
  if (id == null || id <= 0) return null;
  const busType = id & 0x07;
  if (busType === 3) return 11;
  if (busType === 5) return 17;
  return COMPASS_TYPE_BIT[(id >> 16) & 0xff] ?? null;
}
