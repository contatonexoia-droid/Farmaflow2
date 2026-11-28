import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import Papa from "papaparse";

export interface ParsedCmedRow {
  principio_ativo: string;
  laboratorio: string;
  registro_anvisa: string;
  ean: string;
  ean2: string;
  ean3: string;
  nome_comercial: string;
  apresentacao: string;
  classe_terapeutica: string;
  tipo_produto: string;
  tarja: string | null;
}

export interface CmedParseResult {
  sheetName: string;
  sheetsScanned: string[];
  totalReadRows: number;
  ignoredNoEanCount: number;
  rows: ParsedCmedRow[];
}

export function normalizeCmedHeaderCell(val: unknown): string {
  return String(val ?? "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanCmedText(raw: unknown, maxLen = 250): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw)
    .replace(/^\uFEFF/, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!str || !/[a-zA-Z0-9\u00C0-\u024F]/.test(str)) return null;
  const lower = str.toLowerCase();
  if (lower === "n/a" || lower === "na" || lower === "null" || lower === "undefined") {
    return null;
  }
  return str.slice(0, maxLen);
}

export function cleanCmedTarja(raw: unknown): string | null {
  const cleaned = cleanCmedText(raw, 120);
  if (!cleaned) return null;
  const norm = normalizeCmedHeaderCell(cleaned);
  if (
    !norm ||
    norm === "nao informada" ||
    norm === "nao informado" ||
    norm === "indefinida" ||
    norm === "indefinido"
  ) {
    return null;
  }
  return cleaned;
}

export function cleanAnvisaCmedEan(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const digits = Math.trunc(raw).toString();
    if (digits.length < 8 || digits.length > 14 || /^0+$/.test(digits)) return null;
    return digits;
  }
  let str = String(raw).trim();
  if (!str || !/[0-9]/.test(str)) return null;

  if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(str)) {
    const num = Number(str.replace(",", "."));
    if (Number.isFinite(num) && num > 0) {
      str = num.toFixed(0);
    }
  }

  const digits = str.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14 || /^0+$/.test(digits)) {
    return null;
  }
  return digits;
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const exact = headers.findIndex((h) => h === cand);
    if (exact !== -1) return exact;
  }
  for (const cand of candidates) {
    const partial = headers.findIndex((h) => h.includes(cand));
    if (partial !== -1) return partial;
  }
  return -1;
}

function isCmedHeaderRow(normalizedHeaders: string[]): boolean {
  const hasSubstancia = normalizedHeaders.some(
    (h) => h === "substancia" || h.startsWith("substancia")
  );
  const hasEan1 = normalizedHeaders.some(
    (h) => h === "ean 1" || h === "ean1" || h === "ean"
  );
  return hasSubstancia && hasEan1;
}

function buildColumnMap(normalizedHeaders: string[]) {
  return {
    idxSubstancia: findColumnIndex(normalizedHeaders, ["substancia", "principio ativo"]),
    idxLab: findColumnIndex(normalizedHeaders, ["laboratorio"]),
    idxRegistro: findColumnIndex(normalizedHeaders, ["registro"]),
    idxEan1: findColumnIndex(normalizedHeaders, ["ean 1", "ean1", "ean"]),
    idxEan2: findColumnIndex(normalizedHeaders, ["ean 2", "ean2"]),
    idxEan3: findColumnIndex(normalizedHeaders, ["ean 3", "ean3"]),
    idxProduto: findColumnIndex(normalizedHeaders, ["produto", "nome comercial"]),
    idxApresentacao: findColumnIndex(normalizedHeaders, ["apresentacao"]),
    idxClasse: findColumnIndex(normalizedHeaders, ["classe terapeutica"]),
    idxTipo: findColumnIndex(normalizedHeaders, [
      "tipo de produto (status do produto)",
      "tipo de produto",
    ]),
    idxTarja: findColumnIndex(normalizedHeaders, ["tarja"]),
  };
}

function buildParsedRowFromCells(
  getCell: (colIdx: number) => unknown,
  colMap: ReturnType<typeof buildColumnMap>
): { skipEmpty: boolean; missingEan?: boolean; row?: ParsedCmedRow } {
  const substancia = colMap.idxSubstancia >= 0 ? cleanCmedText(getCell(colMap.idxSubstancia), 320) || "" : "";
  const produto = colMap.idxProduto >= 0 ? cleanCmedText(getCell(colMap.idxProduto), 240) || "" : "";

  if (!substancia && !produto) {
    return { skipEmpty: true };
  }

  let ean1 = colMap.idxEan1 >= 0 ? cleanAnvisaCmedEan(getCell(colMap.idxEan1)) : null;
  let ean2 = colMap.idxEan2 >= 0 ? cleanAnvisaCmedEan(getCell(colMap.idxEan2)) : null;
  let ean3 = colMap.idxEan3 >= 0 ? cleanAnvisaCmedEan(getCell(colMap.idxEan3)) : null;

  if (!ean1 && ean2) {
    ean1 = ean2;
    ean2 = null;
  } else if (!ean1 && ean3) {
    ean1 = ean3;
    ean3 = null;
  }

  if (!ean1) {
    return { skipEmpty: false, missingEan: true };
  }

  if (ean2 === ean1) ean2 = null;
  if (ean3 === ean1 || ean3 === ean2) ean3 = null;

  return {
    skipEmpty: false,
    missingEan: false,
    row: {
      principio_ativo: substancia,
      laboratorio: colMap.idxLab >= 0 ? cleanCmedText(getCell(colMap.idxLab), 200) || "" : "",
      registro_anvisa: colMap.idxRegistro >= 0 ? cleanCmedText(getCell(colMap.idxRegistro), 80) || "" : "",
      ean: ean1,
      ean2: ean2 || "",
      ean3: ean3 || "",
      nome_comercial: produto,
      apresentacao: colMap.idxApresentacao >= 0 ? cleanCmedText(getCell(colMap.idxApresentacao), 260) || "" : "",
      classe_terapeutica: colMap.idxClasse >= 0 ? cleanCmedText(getCell(colMap.idxClasse), 220) || "" : "",
      tipo_produto: colMap.idxTipo >= 0 ? cleanCmedText(getCell(colMap.idxTipo), 120) || "" : "",
      tarja: colMap.idxTarja >= 0 ? cleanCmedTarja(getCell(colMap.idxTarja)) : null,
    },
  };
}

function decodeXmlEntities(str: string): string {
  if (!str || !str.includes("&")) return str;
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (full, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        if (entity.startsWith("#x")) {
          const cp = parseInt(entity.slice(2), 16);
          return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
        }
        if (entity.startsWith("#")) {
          const cp = parseInt(entity.slice(1), 10);
          return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
        }
        return full;
      }
    }
  });
}

function colLettersToIndex(letters: string): number {
  let idx = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const code = upper.charCodeAt(i) - 64;
    if (code >= 1 && code <= 26) {
      idx = idx * 26 + code;
    }
  }
  return idx - 1;
}

function extractXmlAttr(attrs: string, attrName: string): string {
  const rx = new RegExp(`(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = rx.exec(attrs);
  if (!m) return "";
  return decodeXmlEntities(m[1] ?? m[2] ?? "");
}

function parseSharedStringsXml(xml: string): string[] {
  const result: string[] = [];
  const siOpenRe = /<(?:[a-zA-Z0-9_-]+:)?si\b([^>]*)>/g;
  const siCloseRe = /<\/(?:[a-zA-Z0-9_-]+:)?si\s*>/g;
  const tExtractRe = /<(?:[a-zA-Z0-9_-]+:)?t\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?t\s*>/gi;

  let pos = 0;
  while (true) {
    siOpenRe.lastIndex = pos;
    const openMatch = siOpenRe.exec(xml);
    if (!openMatch) break;

    if (openMatch[1].trimEnd().endsWith("/")) {
      result.push("");
      pos = siOpenRe.lastIndex;
      continue;
    }

    siCloseRe.lastIndex = siOpenRe.lastIndex;
    const closeMatch = siCloseRe.exec(xml);
    if (!closeMatch) break;

    let inner = xml.slice(siOpenRe.lastIndex, closeMatch.index);
    pos = siCloseRe.lastIndex;

    if (inner.includes("<rPh") || inner.includes(":rPh")) {
      inner = inner.replace(
        /<(?:[a-zA-Z0-9_-]+:)?rPh\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?rPh\s*>/g,
        ""
      );
    }

    let text = "";
    tExtractRe.lastIndex = 0;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tExtractRe.exec(inner)) !== null) {
      if (!tMatch[1].trimEnd().endsWith("/")) {
        text += decodeXmlEntities(tMatch[2]);
      }
    }
    result.push(text);
  }

  return result;
}

function resolveWorkbookSheetsFromZip(
  zip: AdmZip
): Array<{ name: string; entryPath: string }> {
  const entries = zip.getEntries();
  const entryMap = new Map<string, AdmZip.IZipEntry>();
  for (const e of entries) {
    entryMap.set(e.entryName.replace(/^\/+/, "").toLowerCase(), e);
  }

  const relsEntry = entryMap.get("xl/_rels/workbook.xml.rels");
  const relMap = new Map<string, string>();
  if (relsEntry) {
    const relsXml = relsEntry.getData().toString("utf8");
    const relTagRe = /<(?:[a-zA-Z0-9_-]+:)?Relationship\b([^>]*)>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = relTagRe.exec(relsXml)) !== null) {
      const id = extractXmlAttr(rm[1], "Id");
      let target = extractXmlAttr(rm[1], "Target").replace(/\\/g, "/");
      if (!id || !target) continue;
      if (target.startsWith("/")) {
        target = target.slice(1);
      } else if (!target.toLowerCase().startsWith("xl/")) {
        target = `xl/${target.replace(/^\.\//, "")}`;
      }
      relMap.set(id, target);
    }
  }

  const wbEntry = entryMap.get("xl/workbook.xml");
  const resolved: Array<{ name: string; entryPath: string }> = [];
  if (wbEntry) {
    const wbXml = wbEntry.getData().toString("utf8");
    const sheetTagRe = /<(?:[a-zA-Z0-9_-]+:)?sheet\b([^>]*)>/gi;
    let sm: RegExpExecArray | null;
    let seq = 1;
    while ((sm = sheetTagRe.exec(wbXml)) !== null) {
      const attrs = sm[1];
      const name = extractXmlAttr(attrs, "name") || `Aba ${seq}`;
      const rId =
        extractXmlAttr(attrs, "r:id") ||
        extractXmlAttr(attrs, "id");
      let targetPath = rId ? relMap.get(rId) || "" : "";
      if (!targetPath) {
        const sheetIdAttr = extractXmlAttr(attrs, "sheetId");
        targetPath = `xl/worksheets/sheet${sheetIdAttr || seq}.xml`;
      }
      const realEntry = entryMap.get(targetPath.toLowerCase());
      if (realEntry) {
        resolved.push({ name, entryPath: realEntry.entryName });
      }
      seq++;
    }
  }

  if (resolved.length === 0) {
    const sheetEntries = entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
    for (const se of sheetEntries) {
      resolved.push({ name: se.entryName.split("/").pop() || se.entryName, entryPath: se.entryName });
    }
  }

  return resolved;
}

function readRowCellsFromXml(
  rowInner: string,
  sharedStrings: string[],
  neededCols: Set<number> | null
): Map<number, string> {
  const cells = new Map<number, string>();
  const cellOpenRe = /<(?:[a-zA-Z0-9_-]+:)?c\b([^>]*)>/g;
  const cellCloseRe = /<\/(?:[a-zA-Z0-9_-]+:)?c\s*>/g;
  const vRe = /<(?:[a-zA-Z0-9_-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?v\s*>/i;
  const tRe = /<(?:[a-zA-Z0-9_-]+:)?t\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?t\s*>/gi;

  let pos = 0;
  let seqCol = 0;

  while (true) {
    cellOpenRe.lastIndex = pos;
    const openMatch = cellOpenRe.exec(rowInner);
    if (!openMatch) break;

    const attrs = openMatch[1];
    const rMatch = /\br\s*=\s*(?:"([A-Z]+)\d+"|'([A-Z]+)\d+')/i.exec(attrs);
    const colLetters = rMatch ? rMatch[1] ?? rMatch[2] : "";
    const colIdx = colLetters ? colLettersToIndex(colLetters) : seqCol;
    seqCol = colIdx + 1;

    if (attrs.trimEnd().endsWith("/")) {
      pos = cellOpenRe.lastIndex;
      continue;
    }

    cellCloseRe.lastIndex = cellOpenRe.lastIndex;
    const closeMatch = cellCloseRe.exec(rowInner);
    if (!closeMatch) break;

    pos = cellCloseRe.lastIndex;

    if (neededCols !== null && !neededCols.has(colIdx)) {
      continue;
    }

    const inner = rowInner.slice(cellOpenRe.lastIndex, closeMatch.index);
    const cellType = extractXmlAttr(attrs, "t");

    if (cellType === "s") {
      const vm = vRe.exec(inner);
      if (vm) {
        const sIdx = parseInt(vm[1].trim(), 10);
        if (Number.isFinite(sIdx) && sIdx >= 0 && sIdx < sharedStrings.length) {
          cells.set(colIdx, sharedStrings[sIdx]);
        }
      }
    } else if (cellType === "inlineStr") {
      let text = "";
      tRe.lastIndex = 0;
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(inner)) !== null) {
        if (!tm[1].trimEnd().endsWith("/")) {
          text += decodeXmlEntities(tm[2]);
        }
      }
      if (text) cells.set(colIdx, text);
    } else {
      const vm = vRe.exec(inner);
      if (vm) {
        cells.set(colIdx, decodeXmlEntities(vm[1]));
      }
    }
  }

  return cells;
}

function parseXlsxViaAdmZip(buffer: Buffer): CmedParseResult {
  const zip = new AdmZip(buffer);
  const sheets = resolveWorkbookSheetsFromZip(zip);
  if (sheets.length === 0) {
    throw new Error("Nenhuma aba encontrada dentro do arquivo .xlsx enviado.");
  }

  const sharedEntry = zip
    .getEntries()
    .find((e) => e.entryName.replace(/^\/+/, "").toLowerCase() === "xl/sharedstrings.xml");
  const sharedStrings = sharedEntry
    ? parseSharedStringsXml(sharedEntry.getData().toString("utf8"))
    : [];

  const rowOpenRe = /<(?:[a-zA-Z0-9_-]+:)?row\b([^>]*)>/g;
  const rowCloseRe = /<\/(?:[a-zA-Z0-9_-]+:)?row\s*>/g;
  const sheetDataOpenRe = /<(?:[a-zA-Z0-9_-]+:)?sheetData\b([^>]*)>/i;
  const sheetDataCloseRe = /<\/(?:[a-zA-Z0-9_-]+:)?sheetData\s*>/i;

  const sheetsScanned: string[] = [];
  const sampleCells: string[] = [];

  for (const sheetMeta of sheets) {
    sheetsScanned.push(sheetMeta.name);
    const sheetEntry = zip.getEntry(sheetMeta.entryPath);
    if (!sheetEntry) continue;

    const sheetXml = sheetEntry.getData().toString("utf8");
    const sdOpen = sheetDataOpenRe.exec(sheetXml);
    if (!sdOpen || sdOpen[1].trimEnd().endsWith("/")) continue;

    const sdStart = sdOpen.index + sdOpen[0].length;
    const sdClose = sheetDataCloseRe.exec(sheetXml.slice(sdStart));
    const sdEnd = sdClose ? sdStart + sdClose.index : sheetXml.length;

    let pos = sdStart;
    let scannedRows = 0;
    let matchedHeaderColMap: ReturnType<typeof buildColumnMap> | null = null;
    let headerEndPos = sdStart;

    while (pos < sdEnd && scannedRows < 50) {
      rowOpenRe.lastIndex = pos;
      const rOpen = rowOpenRe.exec(sheetXml);
      if (!rOpen || rOpen.index >= sdEnd) break;

      if (rOpen[1].trimEnd().endsWith("/")) {
        pos = rowOpenRe.lastIndex;
        scannedRows++;
        continue;
      }

      rowCloseRe.lastIndex = rowOpenRe.lastIndex;
      const rClose = rowCloseRe.exec(sheetXml);
      if (!rClose || rClose.index > sdEnd) break;

      const rowInner = sheetXml.slice(rowOpenRe.lastIndex, rClose.index);
      pos = rowCloseRe.lastIndex;
      scannedRows++;

      const cellMap = readRowCellsFromXml(rowInner, sharedStrings, null);
      if (cellMap.size === 0) continue;

      let maxCol = 0;
      for (const col of cellMap.keys()) {
        if (col > maxCol) maxCol = col;
      }

      if (sampleCells.length < 8) {
        for (let c = 0; c <= Math.min(maxCol, 12); c++) {
          const v = cleanCmedText(cellMap.get(c), 60);
          if (v && sampleCells.length < 8) sampleCells.push(v);
        }
      }

      const normHeaders = new Array<string>(maxCol + 1).fill("");
      for (const [col, rawVal] of cellMap.entries()) {
        normHeaders[col] = normalizeCmedHeaderCell(rawVal);
      }

      if (isCmedHeaderRow(normHeaders)) {
        matchedHeaderColMap = buildColumnMap(normHeaders);
        headerEndPos = pos;
        break;
      }
    }

    if (!matchedHeaderColMap) continue;

    const neededCols = new Set<number>();
    Object.values(matchedHeaderColMap).forEach((idx) => {
      if (idx >= 0) neededCols.add(idx);
    });

    const validRows: ParsedCmedRow[] = [];
    let totalDataRows = 0;
    let skippedNoEan = 0;

    pos = headerEndPos;
    while (pos < sdEnd) {
      rowOpenRe.lastIndex = pos;
      const rOpen = rowOpenRe.exec(sheetXml);
      if (!rOpen || rOpen.index >= sdEnd) break;

      if (rOpen[1].trimEnd().endsWith("/")) {
        pos = rowOpenRe.lastIndex;
        continue;
      }

      rowCloseRe.lastIndex = rowOpenRe.lastIndex;
      const rClose = rowCloseRe.exec(sheetXml);
      if (!rClose || rClose.index > sdEnd) break;

      const rowInner = sheetXml.slice(rowOpenRe.lastIndex, rClose.index);
      pos = rowCloseRe.lastIndex;

      const cellMap = readRowCellsFromXml(rowInner, sharedStrings, neededCols);
      const parsed = buildParsedRowFromCells(
        (colIdx) => cellMap.get(colIdx) ?? "",
        matchedHeaderColMap
      );
      if (parsed.skipEmpty) continue;
      totalDataRows++;
      if (parsed.missingEan || !parsed.row) {
        skippedNoEan++;
      } else {
        validRows.push(parsed.row);
      }
    }

    if (validRows.length === 0) {
      throw new Error(
        `Aba detectada: "${sheetMeta.name}" (${totalDataRows} linhas lidas), mas nenhuma possui código EAN válido (8 a 14 dígitos).`
      );
    }

    return {
      sheetName: sheetMeta.name,
      sheetsScanned,
      totalReadRows: totalDataRows,
      ignoredNoEanCount: skippedNoEan,
      rows: validRows,
    };
  }

  throw new Error(
    `Cabeçalho oficial da CMED não encontrado em nenhuma aba (colunas "SUBSTÂNCIA" e "EAN 1" obrigatórias). Abas lidas: ${
      sheetsScanned.join(", ") || "nenhuma"
    }${
      sampleCells.length > 0
        ? ` | Células iniciais detectadas: [${sampleCells.join(" | ")}]`
        : ""
    }`
  );
}

function decodeCsvText(buffer: Buffer): string {
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("windows-1252").decode(buffer);
  }
  if (text.includes("\uFFFD")) {
    text = new TextDecoder("windows-1252").decode(buffer);
  }
  return text.replace(/^\uFEFF/, "");
}

function detectCsvDelimiter(csvText: string): string {
  const sampleLines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30);

  const candidates = [";", ",", "\t"];
  let bestDelim = ";";
  let bestScore = -1;

  for (const delim of candidates) {
    let score = 0;
    for (const line of sampleLines) {
      const parts = line.split(delim);
      if (parts.length > 1) {
        score += parts.length;
        const normLine = normalizeCmedHeaderCell(line);
        if (normLine.includes("substancia") && normLine.includes("ean")) {
          score += 500;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestDelim = delim;
    }
  }

  return bestDelim;
}

function parseCsvCmed(buffer: Buffer): CmedParseResult {
  const csvText = decodeCsvText(buffer);
  const delimiter = detectCsvDelimiter(csvText);
  const parsed = Papa.parse<string[]>(csvText, {
    delimiter,
    skipEmptyLines: false,
  });

  const matrix = Array.isArray(parsed.data) ? parsed.data : [];
  if (matrix.length === 0) {
    throw new Error("O arquivo CSV enviado está vazio.");
  }

  let headerRowIdx = -1;
  let colMap: ReturnType<typeof buildColumnMap> | null = null;
  const sampleCells: string[] = [];

  const scanLimit = Math.min(matrix.length, 50);
  for (let r = 0; r < scanLimit; r++) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    const normHeaders = row.map(normalizeCmedHeaderCell);
    if (sampleCells.length < 8) {
      for (let c = 0; c < Math.min(row.length, 12); c++) {
        const v = cleanCmedText(row[c], 60);
        if (v && sampleCells.length < 8) sampleCells.push(v);
      }
    }
    if (isCmedHeaderRow(normHeaders)) {
      headerRowIdx = r;
      colMap = buildColumnMap(normHeaders);
      break;
    }
  }

  if (headerRowIdx === -1 || !colMap) {
    throw new Error(
      `Cabeçalho oficial da CMED não encontrado no CSV (colunas "SUBSTÂNCIA" e "EAN 1" obrigatórias).${
        sampleCells.length > 0
          ? ` Células iniciais detectadas: [${sampleCells.join(" | ")}]`
          : ""
      }`
    );
  }

  const validRows: ParsedCmedRow[] = [];
  let totalDataRows = 0;
  let skippedNoEan = 0;

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    const item = buildParsedRowFromCells((idx) => row[idx] ?? "", colMap);
    if (item.skipEmpty) continue;
    totalDataRows++;
    if (item.missingEan || !item.row) {
      skippedNoEan++;
    } else {
      validRows.push(item.row);
    }
  }

  if (validRows.length === 0) {
    throw new Error(
      `Foram lidas ${totalDataRows} linhas no CSV, mas nenhuma possui código EAN válido (8 a 14 dígitos).`
    );
  }

  return {
    sheetName: "CSV",
    sheetsScanned: ["CSV"],
    totalReadRows: totalDataRows,
    ignoredNoEanCount: skippedNoEan,
    rows: validRows,
  };
}

function readSheetJsCellRaw(sheet: XLSX.WorkSheet, row: number, col: number): unknown {
  if (col < 0) return "";
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = sheet[addr];
  if (!cell) return "";
  if (cell.v !== undefined && cell.v !== null && cell.v !== "") return cell.v;
  return cell.w ?? "";
}

function parseLegacyXlsViaSheetJs(buffer: Buffer): CmedParseResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
  });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error("Nenhuma aba encontrada no arquivo Excel enviado.");
  }

  const sheetsScanned: string[] = [];
  const sampleCells: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    sheetsScanned.push(sheetName);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) continue;

    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const firstRow = Math.max(0, range.s.r);
    const scanEndRow = Math.min(range.e.r, firstRow + 49);

    let headerRowIndex = -1;
    let normalizedHeaders: string[] = [];

    for (let r = firstRow; r <= scanEndRow; r++) {
      const rowHeaders: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const raw = readSheetJsCellRaw(sheet, r, c);
        if (sampleCells.length < 8 && c - range.s.c < 12) {
          const txt = cleanCmedText(raw, 60);
          if (txt) sampleCells.push(txt);
        }
        rowHeaders.push(normalizeCmedHeaderCell(raw));
      }
      if (isCmedHeaderRow(rowHeaders)) {
        headerRowIndex = r;
        normalizedHeaders = rowHeaders;
        break;
      }
    }

    if (headerRowIndex === -1) continue;

    const rawMap = buildColumnMap(normalizedHeaders);
    const offset = range.s.c;
    const toCol = (idx: number) => (idx >= 0 ? offset + idx : -1);
    const colMap = {
      idxSubstancia: toCol(rawMap.idxSubstancia),
      idxLab: toCol(rawMap.idxLab),
      idxRegistro: toCol(rawMap.idxRegistro),
      idxEan1: toCol(rawMap.idxEan1),
      idxEan2: toCol(rawMap.idxEan2),
      idxEan3: toCol(rawMap.idxEan3),
      idxProduto: toCol(rawMap.idxProduto),
      idxApresentacao: toCol(rawMap.idxApresentacao),
      idxClasse: toCol(rawMap.idxClasse),
      idxTipo: toCol(rawMap.idxTipo),
      idxTarja: toCol(rawMap.idxTarja),
    };

    const validRows: ParsedCmedRow[] = [];
    let totalDataRows = 0;
    let skippedNoEan = 0;

    for (let r = headerRowIndex + 1; r <= range.e.r; r++) {
      const item = buildParsedRowFromCells((colIdx) => readSheetJsCellRaw(sheet, r, colIdx), colMap);
      if (item.skipEmpty) continue;
      totalDataRows++;
      if (item.missingEan || !item.row) {
        skippedNoEan++;
      } else {
        validRows.push(item.row);
      }
    }

    if (validRows.length === 0) {
      throw new Error(
        `Aba detectada: "${sheetName}" (${totalDataRows} linhas lidas), mas nenhuma possui código EAN válido (8 a 14 dígitos).`
      );
    }

    return {
      sheetName,
      sheetsScanned,
      totalReadRows: totalDataRows,
      ignoredNoEanCount: skippedNoEan,
      rows: validRows,
    };
  }

  throw new Error(
    `Cabeçalho oficial da CMED não encontrado em nenhuma aba (colunas "SUBSTÂNCIA" e "EAN 1" obrigatórias). Abas lidas: ${
      sheetsScanned.join(", ") || "nenhuma"
    }${
      sampleCells.length > 0
        ? ` | Células iniciais detectadas: [${sampleCells.join(" | ")}]`
        : ""
    }`
  );
}

export function parseCmedSpreadsheetBuffer(
  buffer: Buffer,
  fileName: string
): CmedParseResult {
  const lowerName = String(fileName || "").toLowerCase().trim();
  const isSupportedExt = /\.(xlsx|xls|csv)(\.(xlsx|xls|csv))*$/i.test(lowerName);
  if (!isSupportedExt) {
    throw new Error(
      "Formato de arquivo não suportado. Selecione uma planilha oficial CMED (.xlsx, .xls ou .csv)."
    );
  }

  const isZipMagic =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);

  if (/\.csv(\.csv)*$/i.test(lowerName) && !isZipMagic) {
    return parseCsvCmed(buffer);
  }

  if (isZipMagic || /\.xlsx(\.xlsx)*$/i.test(lowerName)) {
    return parseXlsxViaAdmZip(buffer);
  }

  return parseLegacyXlsViaSheetJs(buffer);
}
