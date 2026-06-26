export type PeriodType = "week" | "month" | "quarter" | "year";

export type PeriodRange = {
  type: PeriodType;
  start: string;
  end: string;
  label: string;
  at: string;
  compareStart: string;
  compareEnd: string;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function parseAtDate(at: string) {
  const [year, month, day] = at.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function periodRangeFor(type: PeriodType, at: string): PeriodRange {
  if (type === "month" && /^\d{4}-\d{2}$/.test(at)) {
    const [year, month] = at.split("-").map(Number);
    const start = `${year}-${pad2(month)}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${pad2(nextMonth)}-01`;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const compareStart = `${prevYear}-${pad2(prevMonth)}-01`;
    const compareEndMonth = prevMonth === 12 ? 1 : prevMonth + 1;
    const compareEndYear = prevMonth === 12 ? prevYear + 1 : prevYear;
    const compareEnd = `${compareEndYear}-${pad2(compareEndMonth)}-01`;
    const label = new Date(year, month - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    return { type, start, end, label, at, compareStart, compareEnd };
  }

  if (type === "quarter" && /^\d{4}-Q[1-4]$/.test(at)) {
    const [yearStr, quarterStr] = at.split("-Q");
    const year = Number(yearStr);
    const quarter = Number(quarterStr);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 3;
    const endYear = endMonth > 12 ? year + 1 : year;
    const normalizedEndMonth = endMonth > 12 ? endMonth - 12 : endMonth;
    const start = `${year}-${pad2(startMonth)}-01`;
    const end = `${endYear}-${pad2(normalizedEndMonth)}-01`;
    const prevQuarter = quarter === 1 ? 4 : quarter - 1;
    const prevYear = quarter === 1 ? year - 1 : year;
    const prevStartMonth = (prevQuarter - 1) * 3 + 1;
    const prevEndMonth = prevStartMonth + 3;
    const prevEndYear = prevEndMonth > 12 ? prevYear + 1 : prevYear;
    const normalizedPrevEndMonth = prevEndMonth > 12 ? prevEndMonth - 12 : prevEndMonth;
    return {
      type,
      start,
      end,
      label: `Q${quarter} ${year}`,
      at,
      compareStart: `${prevYear}-${pad2(prevStartMonth)}-01`,
      compareEnd: `${prevEndYear}-${pad2(normalizedPrevEndMonth)}-01`,
    };
  }

  if (type === "year" && /^\d{4}$/.test(at)) {
    const year = Number(at);
    return {
      type,
      start: `${year}-01-01`,
      end: `${year + 1}-01-01`,
      label: `${year}`,
      at,
      compareStart: `${year - 1}-01-01`,
      compareEnd: `${year}-01-01`,
    };
  }

  if (type === "week" && /^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const anchor = parseAtDate(at);
    const weekStart = startOfWeek(anchor);
    const weekEnd = addDays(weekStart, 7);
    const prevStart = addDays(weekStart, -7);
    const label = `Week of ${weekStart.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
    return {
      type,
      start: toIsoDate(weekStart),
      end: toIsoDate(weekEnd),
      label,
      at: toIsoDate(weekStart),
      compareStart: toIsoDate(prevStart),
      compareEnd: toIsoDate(weekStart),
    };
  }

  return periodRangeFor("month", `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}`);
}

function currentMonthAt() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** Calendar month containing today — default for dashboard & reports. */
export function activeMonthPeriod(): PeriodRange {
  return periodRangeFor("month", currentMonthAt());
}

/** Jan 1 through end of today — default for entity views. */
export function ytdPeriod(): PeriodRange {
  const now = new Date();
  const year = now.getFullYear();
  const end = toIsoDate(addDays(now, 1));
  return {
    type: "year",
    start: `${year}-01-01`,
    end,
    label: `${year} YTD`,
    at: String(year),
    compareStart: `${year - 1}-01-01`,
    compareEnd: `${year}-01-01`,
  };
}

export function parsePeriodParams(
  searchParams: {
    period?: string;
    at?: string;
    month?: string;
  },
  defaultPeriod?: PeriodRange,
): PeriodRange {
  const hasExplicit =
    searchParams.period != null || searchParams.at != null || searchParams.month != null;

  if (!hasExplicit) {
    return defaultPeriod ?? activeMonthPeriod();
  }

  const type = (searchParams.period ?? "month") as PeriodType;
  const at = searchParams.at ?? searchParams.month ?? currentMonthAt();

  if (type === "month" && !searchParams.at && searchParams.month) {
    return periodRangeFor("month", searchParams.month);
  }

  return periodRangeFor(type, at);
}

export function shiftPeriod(range: PeriodRange, delta: number): PeriodRange {
  if (range.type === "month") {
    const [year, month] = range.at.split("-").map(Number);
    const date = new Date(year, month - 1 + delta, 1);
    return periodRangeFor("month", `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`);
  }

  if (range.type === "quarter") {
    const [yearStr, quarterStr] = range.at.split("-Q");
    let year = Number(yearStr);
    let quarter = Number(quarterStr) + delta;
    while (quarter < 1) {
      quarter += 4;
      year -= 1;
    }
    while (quarter > 4) {
      quarter -= 4;
      year += 1;
    }
    return periodRangeFor("quarter", `${year}-Q${quarter}`);
  }

  if (range.type === "year") {
    return periodRangeFor("year", String(Number(range.at) + delta));
  }

  const weekStart = parseAtDate(range.at);
  return periodRangeFor("week", toIsoDate(addDays(weekStart, delta * 7)));
}

export function periodQueryString(range: PeriodRange, extra?: Record<string, string>) {
  const params = new URLSearchParams(extra);
  params.set("period", range.type);
  params.set("at", range.at);
  params.delete("month");
  return params.toString();
}
