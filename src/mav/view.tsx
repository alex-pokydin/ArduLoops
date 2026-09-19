import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { getBuffer, getLatest, getSnapshot, subscribe } from "./store";
import { EMPTY, type Sample } from "./types";

export type Vehicle = "copter" | "plane";

const Ctx = createContext<Vehicle>("copter");

export function VehicleView({
  vehicle,
  children,
}: {
  vehicle: Vehicle;
  children: ReactNode;
}) {
  return <Ctx.Provider value={vehicle}>{children}</Ctx.Provider>;
}

export function useVehicle(): Vehicle {
  return useContext(Ctx);
}

/** True only when HEARTBEAT on the wire matches this view. */
export function frameLive(vehicle: Vehicle, s: Sample = getLatest()): boolean {
  return s.ok && s.frame === vehicle;
}

export function viewSample(vehicle: Vehicle): Sample {
  const s = getSnapshot();
  return frameLive(vehicle, s) ? s : EMPTY;
}

export function viewBuffer(vehicle: Vehicle): Sample[] {
  return frameLive(vehicle) ? getBuffer() : [];
}

export function useViewSample(): Sample {
  const vehicle = useVehicle();
  return useSyncExternalStore(subscribe, () => viewSample(vehicle), () => viewSample(vehicle));
}
