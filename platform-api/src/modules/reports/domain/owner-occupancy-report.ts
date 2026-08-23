import type { JsonObject } from "../../../infrastructure/database/types.js";

export const OwnerOccupancyCapacityBasis = {
  CURRENT_ACTIVE_PHYSICAL_UNITS: "CURRENT_ACTIVE_PHYSICAL_UNITS"
} as const;

export interface OwnerOccupancyDayView extends JsonObject {
  date: string;
  capacityRooms: number;
  confirmedRooms: number;
  confirmedOccupancyBps: number | null;
}

export interface OwnerOccupancyReportView extends JsonObject {
  propertyId: string;
  startDate: string;
  endDate: string;
  nights: number;
  capacityBasis: "CURRENT_ACTIVE_PHYSICAL_UNITS";
  confirmedReservationCount: number;
  capacityRoomNights: number;
  confirmedRoomNights: number;
  confirmedOccupancyBps: number | null;
  days: OwnerOccupancyDayView[];
}
