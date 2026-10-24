import { PharmacyConfig } from "../types";

export interface ParsedDaySchedule {
  open: string; // "HH:mm"
  close: string; // "HH:mm"
  closed: boolean;
}

export interface ParsedOperatingHours {
  is24Hours: boolean;
  weekdays: ParsedDaySchedule; // Segunda a Sábado
  saturday: ParsedDaySchedule; // Sábado (espelhado de weekdays por padrão)
  sunday: ParsedDaySchedule;   // Domingo
  hasExplicitWeekdays?: boolean;
  hasExplicitSunday?: boolean;
}

export interface StoreOperatingStatus {
  isOpen: boolean;
  badgeText: string;
  shortStatusText: string;
  openTimeFormatted: string;
  closeTimeFormatted: string;
  scheduleSummary: string;
  parsedSchedule: ParsedOperatingHours;
}

/**
 * Converte um token de hora como "07h", "7h", "07:00", "21:00:00", "23h30", "23:30h" para "HH:mm"
 */
export function normalizeTimeToken(raw?: string | number | null): string | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  if (!cleaned) return null;

  // Suporta "21:00", "21:00:00", "21h", "21h00", "21:30h", "7"
  const match = cleaned.match(/^(\d{1,2})(?:[:h](\d{1,2}))?(?::\d{1,2})?h?$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;

  if (isNaN(hours) || hours < 0 || hours > 24 || isNaN(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Converte "HH:mm" em minutos desde 00:00
 */
export function timeToMinutes(timeStr: string): number {
  const norm = normalizeTimeToken(timeStr) || "00:00";
  const [h, m] = norm.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
}

/**
 * Formata "HH:mm" para exibição amigável:
 * "21:00" -> "21h"
 * "23:00" -> "23h"
 * "07:00" -> "07h"
 * "23:30" -> "23:30h"
 */
export function formatHourLabel(timeStr: string): string {
  const norm = normalizeTimeToken(timeStr);
  if (!norm) return timeStr;
  const [h, m] = norm.split(":");
  const hourInt = parseInt(h, 10);
  const formattedHour = hourInt < 10 ? `0${hourInt}` : `${hourInt}`;
  if (m === "00") {
    return `${formattedHour}h`;
  }
  return `${formattedHour}:${m}h`;
}

/**
 * Extrai horários estruturados a partir de um texto livre do rodapé como:
 * "Segunda a sábado das 07h às 21h e Domingo das 07h às 21h"
 * "Segunda a Sábado das 07:00h às 22:00h"
 * "Seg a Sex 08h às 20h, Sáb 08h às 18h, Dom Fechado"
 */
export function parseOperatingHoursFromText(text?: string | null): ParsedOperatingHours {
  const defaultResult: ParsedOperatingHours = {
    is24Hours: false,
    weekdays: { open: "07:00", close: "22:00", closed: false },
    saturday: { open: "07:00", close: "22:00", closed: false },
    sunday: { open: "07:00", close: "21:00", closed: false },
    hasExplicitWeekdays: false,
    hasExplicitSunday: false,
  };

  if (!text || !text.trim()) {
    return defaultResult;
  }

  const raw = text.trim();
  const lower = raw.toLowerCase();

  // Verifica se é 24 horas
  if (/\b24\s*(?:h|horas|hrs)\b/i.test(lower)) {
    return {
      is24Hours: true,
      weekdays: { open: "00:00", close: "23:59", closed: false },
      saturday: { open: "00:00", close: "23:59", closed: false },
      sunday: { open: "00:00", close: "23:59", closed: false },
      hasExplicitWeekdays: true,
      hasExplicitSunday: true,
    };
  }

  const connectorPattern = `(?:às|as|a|-|até\\s+as|ate\\s+as|até\\s+às|ate\\s+às|até|ate)`;
  const hourTokenPattern = `(\\d{1,2}(?:[:h]\\d{1,2})?(?::\\d{1,2})?h?)`;
  const timeRangeRegex = new RegExp(`${hourTokenPattern}\\s*${connectorPattern}\\s*${hourTokenPattern}`, "i");

  // 1. Procurar cláusula específica de Domingo
  let sundaySchedule: ParsedDaySchedule | null = null;
  let hasExplicitSunday = false;
  const sundayClosedMatch =
    /dom(?:ingo)?s?\s*(?::|-)?\s*fechado/i.test(lower) ||
    /fechado\s+(?:aos\s+)?dom(?:ingo)?s?/i.test(lower);

  if (sundayClosedMatch) {
    sundaySchedule = { open: "07:00", close: "21:00", closed: true };
    hasExplicitSunday = true;
  } else {
    const sundayClauseRegex = new RegExp(
      `dom(?:ingo)?s?(?:\\s+e\\s+feriados?)?[^0-9]*?${hourTokenPattern}\\s*${connectorPattern}\\s*${hourTokenPattern}`,
      "i"
    );
    const sundayClauseMatch = lower.match(sundayClauseRegex);
    if (sundayClauseMatch) {
      const openNorm = normalizeTimeToken(sundayClauseMatch[1]);
      const closeNorm = normalizeTimeToken(sundayClauseMatch[2]);
      if (openNorm && closeNorm) {
        sundaySchedule = { open: openNorm, close: closeNorm, closed: false };
        hasExplicitSunday = true;
      }
    }
  }

  // 2. Procurar cláusula de Segunda a Sábado ou Segunda a Sexta
  let weekdaysSchedule: ParsedDaySchedule | null = null;
  let saturdaySchedule: ParsedDaySchedule | null = null;
  let hasExplicitWeekdays = false;

  const monSatRegex = new RegExp(
    `seg(?:unda|\\.)?(?:-feira)?\\s*(?:a|à|até|ate|-)\\s*s[áa]b(?:ado|\\.)?[^0-9]*?${hourTokenPattern}\\s*${connectorPattern}\\s*${hourTokenPattern}`,
    "i"
  );
  const monSatMatch = lower.match(monSatRegex);
  if (monSatMatch) {
    const openNorm = normalizeTimeToken(monSatMatch[1]);
    const closeNorm = normalizeTimeToken(monSatMatch[2]);
    if (openNorm && closeNorm) {
      weekdaysSchedule = { open: openNorm, close: closeNorm, closed: false };
      saturdaySchedule = { open: openNorm, close: closeNorm, closed: false };
      hasExplicitWeekdays = true;
    }
  } else {
    const monFriRegex = new RegExp(
      `seg(?:unda|\\.)?(?:-feira)?\\s*(?:a|à|até|ate|-)\\s*sex(?:ta|\\.)?(?:-feira)?[^0-9]*?${hourTokenPattern}\\s*${connectorPattern}\\s*${hourTokenPattern}`,
      "i"
    );
    const monFriMatch = lower.match(monFriRegex);
    if (monFriMatch) {
      const openNorm = normalizeTimeToken(monFriMatch[1]);
      const closeNorm = normalizeTimeToken(monFriMatch[2]);
      if (openNorm && closeNorm) {
        weekdaysSchedule = { open: openNorm, close: closeNorm, closed: false };
        hasExplicitWeekdays = true;
      }
    }

    const satRegex = new RegExp(
      `s[áa]b(?:ado|\\.)?s?[^0-9]*?${hourTokenPattern}\\s*${connectorPattern}\\s*${hourTokenPattern}`,
      "i"
    );
    const satMatch = lower.match(satRegex);
    if (satMatch) {
      const openNorm = normalizeTimeToken(satMatch[1]);
      const closeNorm = normalizeTimeToken(satMatch[2]);
      if (openNorm && closeNorm) {
        saturdaySchedule = { open: openNorm, close: closeNorm, closed: false };
      }
    }
  }

  // Fallback: se não achou "segunda a ...", pega o primeiro range de horário do texto
  if (!weekdaysSchedule) {
    const firstRange = lower.match(timeRangeRegex);
    if (firstRange) {
      const openNorm = normalizeTimeToken(firstRange[1]);
      const closeNorm = normalizeTimeToken(firstRange[2]);
      if (openNorm && closeNorm) {
        weekdaysSchedule = { open: openNorm, close: closeNorm, closed: false };
        hasExplicitWeekdays = true;
        if (!saturdaySchedule) {
          saturdaySchedule = { open: openNorm, close: closeNorm, closed: false };
        }
        const mentionsMonSatOnly = /seg(?:unda|\.)?\s*(?:a|à|-|até)\s*(?:s[áa]b|sex)/i.test(lower);
        if (!sundaySchedule) {
          if (mentionsMonSatOnly) {
            sundaySchedule = { open: openNorm, close: closeNorm, closed: true };
            hasExplicitSunday = true;
          } else {
            sundaySchedule = { open: openNorm, close: closeNorm, closed: false };
            hasExplicitSunday = true;
          }
        }
      }
    }
  }

  const finalWeekdays = weekdaysSchedule || defaultResult.weekdays;
  const finalSaturday = saturdaySchedule || finalWeekdays;

  let finalSunday: ParsedDaySchedule;
  if (sundaySchedule) {
    finalSunday = sundaySchedule;
  } else {
    const mentionsOnlyUpToSatOrFri =
      /seg(?:unda|\.)?(?:-feira)?\s*(?:a|à|-|até)\s*(?:s[áa]b(?:ado|\.)?|sex(?:ta|\.)?)/i.test(lower) &&
      !/dom(?:ingo)?/i.test(lower);
    if (mentionsOnlyUpToSatOrFri) {
      finalSunday = { open: finalWeekdays.open, close: "21:00", closed: true };
      hasExplicitSunday = true;
    } else {
      finalSunday = defaultResult.sunday;
    }
  }

  return {
    is24Hours: false,
    weekdays: finalWeekdays,
    saturday: finalSaturday,
    sunday: finalSunday,
    hasExplicitWeekdays,
    hasExplicitSunday,
  };
}

/**
 * Gera o texto descritivo sincronizado a partir dos horários estruturados
 */
export function buildOperatingHoursSummary(
  openingWeekdays?: string,
  closingWeekdays?: string,
  openingSundays?: string,
  closingSundays?: string,
  closedOnSundays?: boolean,
  is24Hours?: boolean
): string {
  if (is24Hours) {
    return "Aberto 24 horas (Todos os dias)";
  }

  const wOpen = formatHourLabel(openingWeekdays || "07:00");
  const wClose = formatHourLabel(closingWeekdays || "23:00");

  if (closedOnSundays) {
    return `Segunda a sábado das ${wOpen} às ${wClose}`;
  }

  const sOpen = formatHourLabel(openingSundays || "07:00");
  const sClose = formatHourLabel(closingSundays || "21:00");

  if (wOpen === sOpen && wClose === sClose) {
    return `Segunda a domingo das ${wOpen} às ${wClose}`;
  }

  return `Segunda a sábado das ${wOpen} às ${wClose} e Domingo das ${sOpen} às ${sClose}`;
}

/**
 * Resolve a configuração de horários da farmácia priorizando os campos estruturados
 * (`opening_time_weekdays`, `closing_time_weekdays`, `opening_time_sundays`, `closing_time_sundays`)
 * e usando o parser inteligente do texto `horario_funcionamento` como fallback.
 */
export function resolveTenantOperatingHours(tenant?: Partial<PharmacyConfig> | null): ParsedOperatingHours {
  if (!tenant) {
    return parseOperatingHoursFromText(null);
  }

  const anyTenant = tenant as any;
  const fallbackReg =
    anyTenant?.smartBanners?._regulatoryData ||
    anyTenant?.smart_banners?._regulatoryData ||
    {};

  const rawText =
    tenant.horario_funcionamento ||
    tenant.horarioFuncionamento ||
    anyTenant.horariofuncionamento ||
    fallbackReg.horario_funcionamento ||
    "";
  const parsedFromText = parseOperatingHoursFromText(rawText);

  const is24h =
    tenant.is_24_hours !== undefined
      ? Boolean(tenant.is_24_hours)
      : fallbackReg.is_24_hours !== undefined
      ? Boolean(fallbackReg.is_24_hours)
      : parsedFromText.is24Hours;

  if (is24h) {
    return {
      is24Hours: true,
      weekdays: { open: "00:00", close: "23:59", closed: false },
      saturday: { open: "00:00", close: "23:59", closed: false },
      sunday: { open: "00:00", close: "23:59", closed: false },
    };
  }

  // Leitura direta dos campos estruturados da tabela tenants (com fallback para _regulatoryData e texto)
  const rawWOpen = normalizeTimeToken(tenant.opening_time_weekdays ?? anyTenant.openingtimeweekdays);
  const regWOpen = normalizeTimeToken(fallbackReg.opening_time_weekdays);
  const wOpen = rawWOpen || regWOpen || parsedFromText.weekdays.open;

  const rawWClose = normalizeTimeToken(tenant.closing_time_weekdays ?? anyTenant.closingtimeweekdays);
  const regWClose = normalizeTimeToken(fallbackReg.closing_time_weekdays);

  // Se o banco retornou o DEFAULT '23:00' da migration, mas o _regulatoryData ou o texto explícito
  // contém outro horário (ex: '21:00'), respeita o valor real configurado pelo lojista.
  let wClose: string;
  if (rawWClose) {
    if (rawWClose === "23:00" && regWClose && regWClose !== "23:00") {
      wClose = regWClose;
    } else if (
      rawWClose === "23:00" &&
      !regWClose &&
      parsedFromText.hasExplicitWeekdays &&
      parsedFromText.weekdays.close !== "23:00"
    ) {
      wClose = parsedFromText.weekdays.close;
    } else {
      wClose = rawWClose;
    }
  } else {
    wClose = regWClose || parsedFromText.weekdays.close;
  }

  // No painel administrativo, o bloco estruturado é "Segunda a Sábado" (opening_time_weekdays / closing_time_weekdays).
  // Portanto, Sábado segue diretamente os horários de Segunda a Sábado configurados no painel.
  const satOpen = wOpen;
  const satClose = wClose;

  const sunClosed =
    tenant.closed_on_sundays !== undefined && tenant.closed_on_sundays !== null
      ? Boolean(tenant.closed_on_sundays)
      : fallbackReg.closed_on_sundays !== undefined && fallbackReg.closed_on_sundays !== null
      ? Boolean(fallbackReg.closed_on_sundays)
      : parsedFromText.sunday.closed;

  const rawSunOpen = normalizeTimeToken(tenant.opening_time_sundays ?? anyTenant.openingtimesundays);
  const regSunOpen = normalizeTimeToken(fallbackReg.opening_time_sundays);
  const sunOpen = rawSunOpen || regSunOpen || parsedFromText.sunday.open;

  const rawSunClose = normalizeTimeToken(tenant.closing_time_sundays ?? anyTenant.closingtimesundays);
  const regSunClose = normalizeTimeToken(fallbackReg.closing_time_sundays);
  const sunClose = rawSunClose || regSunClose || parsedFromText.sunday.close;

  return {
    is24Hours: false,
    weekdays: { open: wOpen, close: wClose, closed: false },
    saturday: { open: satOpen, close: satClose, closed: false },
    sunday: { open: sunOpen, close: sunClose, closed: sunClosed },
  };
}

/**
 * Calcula o status em tempo real da farmácia com base nos campos estruturados
 * (`opening_time_weekdays`, `closing_time_weekdays`, `opening_time_sundays`, `closing_time_sundays`)
 * e no dia da semana/hora atual do cliente.
 */
export function getStoreOperatingStatus(
  tenant?: Partial<PharmacyConfig> | null,
  now: Date = new Date()
): StoreOperatingStatus {
  const schedule = resolveTenantOperatingHours(tenant);
  const rawText = tenant?.horario_funcionamento || tenant?.horarioFuncionamento || "";

  const scheduleSummary =
    rawText.trim() ||
    buildOperatingHoursSummary(
      schedule.weekdays.open,
      schedule.weekdays.close,
      schedule.sunday.open,
      schedule.sunday.close,
      schedule.sunday.closed,
      schedule.is24Hours
    );

  if (schedule.is24Hours) {
    return {
      isOpen: true,
      badgeText: "Aberto 24 horas",
      shortStatusText: "Aberto 24h",
      openTimeFormatted: "00h",
      closeTimeFormatted: "23:59h",
      scheduleSummary,
      parsedSchedule: schedule,
    };
  }

  const dayOfWeek = now.getDay(); // 0 = Domingo, 1..6 = Segunda a Sábado
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Segunda a Sábado (1..6) usa schedule.weekdays (opening_time_weekdays / closing_time_weekdays)
  // Domingo (0) usa schedule.sunday (opening_time_sundays / closing_time_sundays)
  const getScheduleForDay = (day: number): ParsedDaySchedule => {
    if (day === 0) return schedule.sunday;
    return schedule.weekdays;
  };

  const todaySchedule = getScheduleForDay(dayOfWeek);
  const tomorrowDay = (dayOfWeek + 1) % 7;
  const tomorrowSchedule = getScheduleForDay(tomorrowDay);

  const openMinutes = timeToMinutes(todaySchedule.open);
  const closeMinutes = timeToMinutes(todaySchedule.close);

  const openFormatted = formatHourLabel(todaySchedule.open);
  const closeFormatted = formatHourLabel(todaySchedule.close);

  // Caso o dia de hoje seja fechado (ex: Domingo fechado)
  if (todaySchedule.closed) {
    const nextOpenFormatted = formatHourLabel(tomorrowSchedule.open);
    return {
      isOpen: false,
      badgeText: !tomorrowSchedule.closed
        ? `Fechado - Abre amanhã às ${nextOpenFormatted}`
        : "Fechado",
      shortStatusText: "Fechado",
      openTimeFormatted: openFormatted,
      closeTimeFormatted: closeFormatted,
      scheduleSummary,
      parsedSchedule: schedule,
    };
  }

  // Verifica se está dentro do horário de funcionamento hoje
  const isOpenNow =
    closeMinutes >= openMinutes
      ? currentMinutes >= openMinutes && currentMinutes < closeMinutes
      : currentMinutes >= openMinutes || currentMinutes < closeMinutes; // Suporte caso feche após meia-noite

  if (isOpenNow) {
    return {
      isOpen: true,
      badgeText: `Aberto até as ${closeFormatted}`,
      shortStatusText: `Aberto até as ${closeFormatted}`,
      openTimeFormatted: openFormatted,
      closeTimeFormatted: closeFormatted,
      scheduleSummary,
      parsedSchedule: schedule,
    };
  }

  // Se ainda não abriu hoje (antes do horário de abertura)
  if (currentMinutes < openMinutes) {
    return {
      isOpen: false,
      badgeText: `Fechado - Abre hoje às ${openFormatted}`,
      shortStatusText: "Fechado",
      openTimeFormatted: openFormatted,
      closeTimeFormatted: closeFormatted,
      scheduleSummary,
      parsedSchedule: schedule,
    };
  }

  // Já passou do horário de fechamento de hoje -> mostra quando abre amanhã
  if (!tomorrowSchedule.closed) {
    const tomorrowOpenFormatted = formatHourLabel(tomorrowSchedule.open);
    return {
      isOpen: false,
      badgeText: `Fechado - Abre amanhã às ${tomorrowOpenFormatted}`,
      shortStatusText: "Fechado",
      openTimeFormatted: openFormatted,
      closeTimeFormatted: closeFormatted,
      scheduleSummary,
      parsedSchedule: schedule,
    };
  }

  // Se amanhã for domingo fechado, abre na segunda-feira
  const mondayOpenFormatted = formatHourLabel(schedule.weekdays.open);
  return {
    isOpen: false,
    badgeText: `Fechado - Abre segunda às ${mondayOpenFormatted}`,
    shortStatusText: "Fechado",
    openTimeFormatted: openFormatted,
    closeTimeFormatted: closeFormatted,
    scheduleSummary,
    parsedSchedule: schedule,
  };
}
