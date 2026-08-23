import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  FinancialLedgerJournalView,
  FinancialLedgerPostingResult
} from "../domain/financial-ledger.js";
import type { RevenueRecognitionScheduleLineView } from "../domain/revenue-recognition.js";
import { RevenueLedgerPostingRepository } from "../infrastructure/revenue-ledger-posting-repository.js";
import { FinancialLedgerPostingService } from "./financial-ledger-posting-service.js";
import { RevenueRecognitionScheduleService } from "./revenue-recognition-schedule-service.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface RevenueLedgerPostingResult extends JsonObject {
  reservationId: string;
  scheduleId: string;
  revenueBasisMinor: number;
  journalCount: number;
  createdJournalCount: number;
  journals: FinancialLedgerJournalView[];
}

export function revenueRecognitionDateForLine(
  line: Pick<RevenueRecognitionScheduleLineView, "serviceScope" | "stayDate">,
  departureDate: string
): string {
  if (!DATE_PATTERN.test(departureDate)) {
    throw new ConflictError("Reservation departure date is not a canonical accounting date");
  }

  if (line.serviceScope === "NIGHT") {
    if (line.stayDate === null || !DATE_PATTERN.test(line.stayDate)) {
      throw new ConflictError("Night revenue line is missing its immutable stay date");
    }
    return line.stayDate;
  }

  if (line.serviceScope === "STAY") {
    if (line.stayDate !== null) {
      throw new ConflictError("Stay-level revenue line must not carry a nightly stay date");
    }
    return departureDate;
  }

  throw new ConflictError("Unsupported revenue recognition service scope");
}

function sumRevenue(values: number[]): number {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConflictError("Revenue schedule contains an invalid money amount");
    }
    total += BigInt(value);
  }

  const result = Number(total);
  if (!Number.isSafeInteger(result)) {
    throw new ConflictError("Revenue schedule exceeds safe integer money limits");
  }
  return result;
}

export class RevenueLedgerPostingService {
  constructor(
    private readonly repository = new RevenueLedgerPostingRepository(),
    private readonly schedules = new RevenueRecognitionScheduleService(),
    private readonly ledger = new FinancialLedgerPostingService()
  ) {}

  async postForCheckedOutReservation(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
    },
    request: RequestMetadata
  ): Promise<RevenueLedgerPostingResult> {
    const completion = await this.repository.completionSource(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId
    );

    if (!completion) throw new NotFoundError("Reservation not found");
    if (completion.reservation.status !== "CHECKED_OUT") {
      throw new ConflictError("Revenue can be posted only after canonical checkout");
    }
    if (completion.checkoutHistories.length !== 1) {
      throw new ConflictError(
        "Reservation must have exactly one canonical checkout history record"
      );
    }

    const checkoutHistory = completion.checkoutHistories[0]!;
    const scheduleResult = await this.schedules.ensureForReservation(trx, input, request);
    const schedule = scheduleResult.schedule;

    if (
      schedule.organizationId !== input.organizationId ||
      schedule.propertyId !== input.propertyId ||
      schedule.reservationId !== input.reservationId ||
      schedule.currencyCode !== completion.reservation.currency_code
    ) {
      throw new ConflictError("Revenue schedule identity does not match checked-out reservation");
    }

    const positiveLines = schedule.lines.filter((line) => line.revenueMinor > 0);
    const postingResults: FinancialLedgerPostingResult[] = [];

    for (const line of positiveLines) {
      const recognitionDate = revenueRecognitionDateForLine(
        line,
        completion.reservation.departure_date
      );

      postingResults.push(
        await this.ledger.postRevenueRecognized(
          trx,
          {
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            reservationId: input.reservationId,
            revenueScheduleLineId: line.id,
            stayCompletionHistoryId: checkoutHistory.id,
            recognitionDate,
            amountMinor: line.revenueMinor,
            currencyCode: line.currencyCode,
            occurredAt: checkoutHistory.created_at
          },
          request
        )
      );
    }

    const references = await this.repository.revenueJournalReferencesForSchedule(trx, schedule.id);
    if (references.length !== positiveLines.length) {
      throw new ConflictError(
        "Revenue ledger journal count does not match positive schedule lines"
      );
    }

    const referenceByLine = new Map(
      references.map((reference) => [reference.revenue_schedule_line_id, reference])
    );

    for (const line of positiveLines) {
      const reference = referenceByLine.get(line.id);
      const expectedRecognitionDate = revenueRecognitionDateForLine(
        line,
        completion.reservation.departure_date
      );

      if (
        !reference ||
        reference.stay_completion_history_id !== checkoutHistory.id ||
        reference.recognition_date !== expectedRecognitionDate ||
        reference.amount_minor !== line.revenueMinor ||
        reference.currency_code !== line.currencyCode
      ) {
        throw new ConflictError(
          "Revenue ledger journal is inconsistent with immutable schedule line"
        );
      }
    }

    const observedRevenue = sumRevenue(references.map((reference) => reference.amount_minor));
    if (observedRevenue !== schedule.revenueBasisMinor) {
      throw new ConflictError("Revenue ledger journals do not reconcile to schedule revenue basis");
    }

    return {
      reservationId: input.reservationId,
      scheduleId: schedule.id,
      revenueBasisMinor: schedule.revenueBasisMinor,
      journalCount: postingResults.length,
      createdJournalCount: postingResults.filter((result) => result.created).length,
      journals: postingResults.map((result) => result.journal)
    };
  }
}
