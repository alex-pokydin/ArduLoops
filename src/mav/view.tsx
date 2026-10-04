import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from "react";
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

/**
 * One field (or a small slice). The same value is returned until `eq` says it
 * changed, so a sibling that shows a different field does not render again.
 * A slice that is an object needs `eq`; otherwise a new object every packet
 * would render forever.
 */
/** Same as usePicked, but the shell snapshot — not filtered to this vehicle. */
export function useStorePicked<T>(pick: (s: Sample) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ value: T } | null>(null);
  const get = () => {
    const next = pick(getSnapshot());
    const hit = cache.current;
    if (hit && eq(hit.value, next)) return hit.value;
    cache.current = { value: next };
    return next;
  };
  return useSyncExternalStore(subscribe, get, get);
}

export function usePicked<T>(pick: (s: Sample) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const vehicle = useVehicle();
  const cache = useRef<{ vehicle: Vehicle; value: T } | null>(null);
  const get = () => {
    const next = pick(viewSample(vehicle));
    const hit = cache.current;
    if (hit && hit.vehicle === vehicle && eq(hit.value, next)) return hit.value;
    cache.current = { vehicle, value: next };
    return next;
  };
  return useSyncExternalStore(subscribe, get, get);
}
