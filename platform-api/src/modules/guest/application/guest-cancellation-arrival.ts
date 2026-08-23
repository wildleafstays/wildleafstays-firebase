import { ConflictError } from "../../../shared/errors/app-error.js";

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface GuestCancellationArrivalInput {
  arrivalDate: string;
  arrivalLocalTime: string;
  timeZone: string;
}

function conflict(message: string, details: Record<string, unknown> = {}): ConflictError {
  return new ConflictError(message, {
    manualReviewRequired: true,
    ...details
  });
}

function parseLocalDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw conflict("Canonical arrival date is invalid");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw conflict("Canonical arrival date is invalid");
  }

  return {
    year,
    month,
    day
  };
}

function parseLocalTime(value: string): {
  hour: number;
  minute: number;
} {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?$/.exec(value);

  if (!match) {
    throw conflict("Immutable cancellation arrival-local-time is invalid");
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    throw conflict("Property timezone is not a valid IANA timezone", {
      timeZone
    });
  }
}

function partsAt(formatter: Intl.DateTimeFormat, instantMs: number): LocalDateTimeParts {
  const values: Record<string, string> = {};

  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const result: LocalDateTimeParts = {
    year: Number(values["year"]),
    month: Number(values["month"]),
    day: Number(values["day"]),
    hour: Number(values["hour"]),
    minute: Number(values["minute"])
  };

  if (
    !Number.isInteger(result.year) ||
    !Number.isInteger(result.month) ||
    !Number.isInteger(result.day) ||
    !Number.isInteger(result.hour) ||
    !Number.isInteger(result.minute)
  ) {
    throw conflict("Property timezone could not resolve canonical arrival wall-clock time");
  }

  return result;
}

function sameLocal(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

export function resolveGuestCancellationArrivalInstant(input: GuestCancellationArrivalInput): Date {
  const date = parseLocalDate(input.arrivalDate);
  const time = parseLocalTime(input.arrivalLocalTime);
  const formatter = formatterFor(input.timeZone);

  const target: LocalDateTimeParts = {
    ...date,
    ...time
  };

  const naiveUtcMs = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute
  );

  const possibleOffsets = new Set<number>();

  for (let hoursFromTarget = -48; hoursFromTarget <= 48; hoursFromTarget += 6) {
    const sampleMs = naiveUtcMs + hoursFromTarget * 60 * 60 * 1000;

    const local = partsAt(formatter, sampleMs);

    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute
    );

    const offsetMinutes = (representedAsUtc - sampleMs) / 60_000;

    if (Number.isInteger(offsetMinutes) && Math.abs(offsetMinutes) <= 24 * 60) {
      possibleOffsets.add(offsetMinutes);
    }
  }

  const candidates = new Set<number>();

  for (const offsetMinutes of possibleOffsets) {
    const candidateMs = naiveUtcMs - offsetMinutes * 60_000;

    if (sameLocal(partsAt(formatter, candidateMs), target)) {
      candidates.add(candidateMs);
    }
  }

  if (candidates.size === 0) {
    throw conflict("Canonical arrival wall-clock time does not exist in the property timezone", {
      arrivalDate: input.arrivalDate,
      arrivalLocalTime: input.arrivalLocalTime,
      timeZone: input.timeZone
    });
  }

  if (candidates.size > 1) {
    throw conflict("Canonical arrival wall-clock time is ambiguous in the property timezone", {
      arrivalDate: input.arrivalDate,
      arrivalLocalTime: input.arrivalLocalTime,
      timeZone: input.timeZone
    });
  }

  const instantMs = [...candidates][0];

  if (instantMs === undefined) {
    throw conflict("Canonical arrival instant could not be resolved");
  }

  return new Date(instantMs);
}
