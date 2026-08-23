import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface OwnerPortfolioPropertyView extends JsonObject {
  propertyId: string;
  name: string;
  timezone: string;
  currentActivePhysicalRooms: number;
  capacityRoomNights: number;
  confirmedRoomNights: number;
  occupancyBps: number | null;
  recognizedRevenueMinor: number;
  reversedRevenueMinor: number;
  netRecognizedRevenueMinor: number;
}

export interface OwnerPortfolioReportView extends JsonObject {
  organizationId: string;
  startDate: string;
  endDate: string;
  currencyCode: string;
  propertyCount: number;
  currentActivePhysicalRooms: number;
  capacityRoomNights: number;
  confirmedRoomNights: number;
  occupancyBps: number | null;
  recognizedRevenueMinor: number;
  reversedRevenueMinor: number;
  netRecognizedRevenueMinor: number;
  properties: OwnerPortfolioPropertyView[];
}
