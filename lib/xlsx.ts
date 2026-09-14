type CellValue = string | number | boolean | null | undefined;
export type WorkbookSheet = { name: string; rows: CellValue[][] };

const encoder = new TextEncoder();

function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let result = "";
  let value = index + 1;
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function worksheetXml(rows: CellValue[][]): string {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      if (value === null || value === undefined || value === "") return "";
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
      if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const dimension = `A1:${columnName(maxColumns - 1)}${Math.max(1, rows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${rowXml}</sheetData></worksheet>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff]; }
function u32(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]; }

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function zipStore(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const localHeader = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(checksum), ...u32(entry.data.length), ...u32(entry.data.length), ...u16(name.length), ...u16(0),
    ]);
    localParts.push(localHeader, name, entry.data);
    const centralHeader = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(checksum), ...u32(entry.data.length), ...u32(entry.data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + entry.data.length;
  }

  const central = concat(centralParts);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(offset), ...u16(0),
  ]);
  return concat([...localParts, central, end]);
}

export function createXlsx(sheets: WorkbookSheet[]): Uint8Array {
  if (!sheets.length) throw new Error("工作簿至少需要一个工作表。" );
  const safeSheets = sheets.map((sheet, index) => ({
    name: (sheet.name.replace(/[\\/*?:\[\]]/g, "_").slice(0, 31) || `Sheet${index + 1}`),
    rows: sheet.rows,
  }));
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${safeSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${safeSheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safeSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`;
  const entries = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    ...safeSheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: encoder.encode(worksheetXml(sheet.rows)) })),
  ];
  return zipStore(entries);
}

