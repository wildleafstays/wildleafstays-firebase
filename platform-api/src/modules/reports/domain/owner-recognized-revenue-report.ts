import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface OwnerRecognizedRevenueDayView extends JsonObject {
  date: string;
  recognizedRevenueMinor: number;
  reversedRevenueMinor: number;
  netRecognizedRevenueMinor: number;
}

export interface OwnerRecognizedRevenueReportView extends JsonObject {
  propertyId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  currencyCode: string;
  recognizedRevenueMinor: number;
  reversedRevenueMinor: number;
  netRecognizedRevenueMinor: number;
  days: OwnerRecognizedRevenueDayView[];
}
