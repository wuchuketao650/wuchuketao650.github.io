const SOFTWARE_TAG_VALUE = 'ExifEditor Web';
const textEncoder = new TextEncoder();

const EDITABLE_TYPES = ['image/jpeg', 'image/png'];

export function isEditableFile(file) {
  return EDITABLE_TYPES.includes(file.type);
}

export async function readExifFields(file) {
  if (!window.exifr || !file) return {};
  try {
    const parsed = await window.exifr.parse(file, { reviveValues: true });
    return mapExifToForm(parsed || {});
  } catch (error) {
    console.warn('读取EXIF失败:', error);
    return {};
  }
}

export async function writeExifData(file, formValues) {
  if (!file) throw new Error('未选择文件');
  const payload = sanitizePayload(formValues);
  if (!hasWritableContent(payload)) {
    throw new Error('没有可写入的 EXIF 数据');
  }
  if (isJpeg(file)) {
    return writeExifToJpeg(file, payload);
  }
  if (isPng(file)) {
    return writeExifToPng(file, payload);
  }
  throw new Error('当前格式暂不支持写入 EXIF');
}

export async function removeExifData(file) {
  if (!file) throw new Error('未选择文件');
  if (isJpeg(file)) {
    return removeExifFromJpeg(file);
  }
  if (isPng(file)) {
    return removeExifFromPng(file);
  }
  throw new Error('当前格式暂不支持移除 EXIF');
}

async function writeExifToJpeg(file, payload) {
  if (!window.piexif) {
    throw new Error('EXIF 写入模块未加载');
  }
  const dataURL = await fileToDataURL(file);
  const exifObj = window.piexif.load(dataURL);
  applyPayloadToExif(exifObj, payload);
  const exifBytes = window.piexif.dump(exifObj);
  const output = window.piexif.insert(exifBytes, dataURL);
  return dataURLToFile(output, file);
}

async function writeExifToPng(file, payload) {
  const buffer = await file.arrayBuffer();
  const exifBinary = buildExifSegment(payload);
  const updatedBuffer = insertExifIntoPng(buffer, exifBinary);
  return new File([updatedBuffer], file.name, {
    type: file.type,
    lastModified: Date.now()
  });
}

async function removeExifFromJpeg(file) {
  if (!window.piexif) {
    throw new Error('EXIF 写入模块未加载');
  }
  const dataURL = await fileToDataURL(file);
  const stripped = window.piexif.remove(dataURL);
  return dataURLToFile(stripped, file);
}

async function removeExifFromPng(file) {
  const buffer = await file.arrayBuffer();
  const cleaned = stripExifFromPng(buffer);
  return new File([cleaned], file.name, {
    type: file.type,
    lastModified: Date.now()
  });
}

function mapExifToForm(raw) {
  const dateField = normalizeDateString(
    raw.DateTimeOriginal || raw.DateTimeDigitized || raw.DateTime
  );
  const exposure = formatExposure(raw.ExposureTime);
  const fNumber = raw.FNumber ? `f/${Number(raw.FNumber).toFixed(1)}` : '';
  const focal = raw.FocalLength
    ? `${Number(raw.FocalLength).toFixed(1)}mm`
    : '';
  const latitude = typeof raw.latitude === 'number'
    ? raw.latitude
    : convertGpsToDecimal(raw.GPSLatitude, raw.GPSLatitudeRef);
  const longitude = typeof raw.longitude === 'number'
    ? raw.longitude
    : convertGpsToDecimal(raw.GPSLongitude, raw.GPSLongitudeRef);
  const altitude = typeof raw.GPSAltitude === 'number'
    ? raw.GPSAltitudeRef === 1 ? -raw.GPSAltitude : raw.GPSAltitude
    : null;

  return {
    Make: raw.Make || '',
    Model: raw.Model || '',
    DateTime: dateField || '',
    ImageDescription: raw.ImageDescription || '',
    Artist: raw.Artist || '',
    Copyright: raw.Copyright || '',
    Orientation: raw.Orientation || 1,
    FNumber: fNumber,
    ExposureTime: exposure,
    ISOSpeedRatings: raw.ISO || raw.ISOSpeedRatings || '',
    FocalLength: focal,
    LensModel: raw.LensModel || '',
    GPSLatitude: latitude,
    GPSLongitude: longitude,
    GPSAltitude: altitude
  };
}

function sanitizePayload(values = {}) {
  const payload = { ...values };
  Object.keys(payload).forEach((key) => {
    if (typeof payload[key] === 'string') {
      payload[key] = payload[key].trim();
    }
  });
  if (!payload.Orientation) {
    payload.Orientation = 1;
  }
  if (typeof payload.Orientation !== 'number') {
    payload.Orientation = Number(payload.Orientation) || 1;
  }
  return payload;
}

function hasWritableContent(payload) {
  return Object.entries(payload).some(([key, value]) => {
    if (key === 'Orientation') {
      return true;
    }
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return !Number.isNaN(value);
    return false;
  });
}

function applyPayloadToExif(exifObj, payload) {
  const { ImageIFD, ExifIFD, GPSIFD } = window.piexif;
  exifObj['0th'] = exifObj['0th'] || {};
  exifObj.Exif = exifObj.Exif || {};
  exifObj.GPS = exifObj.GPS || {};

  const zeroth = exifObj['0th'];
  const exif = exifObj.Exif;
  const gps = exifObj.GPS;

  assignAscii(zeroth, ImageIFD.Make, payload.Make);
  assignAscii(zeroth, ImageIFD.Model, payload.Model);
  assignAscii(zeroth, ImageIFD.Software, SOFTWARE_TAG_VALUE);
  assignAscii(zeroth, ImageIFD.ImageDescription, payload.ImageDescription);
  assignAscii(zeroth, ImageIFD.Artist, payload.Artist);
  assignAscii(zeroth, ImageIFD.Copyright, payload.Copyright);
  assignAscii(zeroth, ImageIFD.DateTime, payload.DateTime);
  assignShort(zeroth, ImageIFD.Orientation, payload.Orientation || 1);

  if (payload.DateTime) {
    assignAscii(exif, ExifIFD.DateTimeOriginal, payload.DateTime);
    assignAscii(exif, ExifIFD.DateTimeDigitized, payload.DateTime);
  } else {
    delete exif[ExifIFD.DateTimeOriginal];
    delete exif[ExifIFD.DateTimeDigitized];
  }

  assignRational(exif, ExifIFD.ExposureTime, parseFraction(payload.ExposureTime));
  assignRational(exif, ExifIFD.FNumber, parseFraction(stripPrefix(payload.FNumber, 'f/')));
  assignShort(exif, ExifIFD.ISOSpeedRatings, Number(payload.ISOSpeedRatings));
  assignRational(exif, ExifIFD.FocalLength, parseFraction(stripSuffix(payload.FocalLength, 'mm')));
  assignAscii(exif, ExifIFD.LensModel, payload.LensModel);

  if (typeof payload.GPSLatitude === 'number' && typeof payload.GPSLongitude === 'number') {
    const lat = payload.GPSLatitude;
    const lng = payload.GPSLongitude;
    gps[GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S';
    gps[GPSIFD.GPSLatitude] = convertFractionsToTuple(createGpsRationals(lat));
    gps[GPSIFD.GPSLongitudeRef] = lng >= 0 ? 'E' : 'W';
    gps[GPSIFD.GPSLongitude] = convertFractionsToTuple(createGpsRationals(lng));
    if (typeof payload.GPSAltitude === 'number') {
      const altitude = payload.GPSAltitude;
      gps[GPSIFD.GPSAltitudeRef] = altitude < 0 ? 1 : 0;
      gps[GPSIFD.GPSAltitude] = toExifTuple(toPositiveFraction(Math.abs(altitude)));
    } else {
      delete gps[GPSIFD.GPSAltitudeRef];
      delete gps[GPSIFD.GPSAltitude];
    }
  } else {
    delete gps[GPSIFD.GPSLatitude];
    delete gps[GPSIFD.GPSLatitudeRef];
    delete gps[GPSIFD.GPSLongitude];
    delete gps[GPSIFD.GPSLongitudeRef];
    delete gps[GPSIFD.GPSAltitude];
    delete gps[GPSIFD.GPSAltitudeRef];
  }
}

function assignAscii(target, tag, value) {
  if (!target) return;
  if (value) {
    target[tag] = value;
  } else {
    delete target[tag];
  }
}

function assignShort(target, tag, value) {
  if (!target) return;
  if (value === null || value === undefined || Number.isNaN(value)) {
    delete target[tag];
  } else {
    target[tag] = Number(value);
  }
}

function assignRational(target, tag, fraction) {
  if (!target) return;
  if (!fraction) {
    delete target[tag];
  } else {
    target[tag] = toExifTuple(fraction);
  }
}

function toExifTuple(fraction) {
  return [fraction.numerator, fraction.denominator];
}

function convertFractionsToTuple(fractions) {
  return fractions.map((fraction) => toExifTuple(fraction));
}

function buildExifSegment(payload) {
  const littleEndian = true;
  const ifd0Entries = [];
  const exifEntries = [];
  const gpsEntries = [];

  addAscii(ifd0Entries, 0x010F, payload.Make);
  addAscii(ifd0Entries, 0x0110, payload.Model);
  addAscii(ifd0Entries, 0x0131, SOFTWARE_TAG_VALUE);
  addAscii(ifd0Entries, 0x0132, payload.DateTime);
  addAscii(ifd0Entries, 0x010E, payload.ImageDescription);
  addAscii(ifd0Entries, 0x013B, payload.Artist);
  addAscii(ifd0Entries, 0x8298, payload.Copyright);
  addShort(ifd0Entries, 0x0112, payload.Orientation || 1);

  if (hasExifSection(payload)) {
    const entry = createPointerEntry(0x8769);
    ifd0Entries.push(entry);
  }
  if (hasGpsSection(payload)) {
    const entry = createPointerEntry(0x8825);
    ifd0Entries.push(entry);
  }

  if (payload.DateTime) {
    addAscii(exifEntries, 0x9003, payload.DateTime);
    addAscii(exifEntries, 0x9004, payload.DateTime);
  }
  addUndefined(exifEntries, 0x9000, new Uint8Array([0x30, 0x32, 0x33, 0x31]));
  addUndefined(exifEntries, 0xA000, new Uint8Array([0x30, 0x31, 0x30, 0x30]));
  addRational(exifEntries, 0x829A, parseFraction(payload.ExposureTime));
  addRational(exifEntries, 0x829D, parseFraction(stripPrefix(payload.FNumber, 'f/')));
  addShort(exifEntries, 0x8827, Number(payload.ISOSpeedRatings));
  addRational(exifEntries, 0x920A, parseFraction(stripSuffix(payload.FocalLength, 'mm')));
  addAscii(exifEntries, 0xA434, payload.LensModel);

  if (hasGpsSection(payload)) {
    addByteArray(gpsEntries, 0x0000, new Uint8Array([2, 3, 0, 0]));
    addAscii(gpsEntries, 0x0001, payload.GPSLatitude >= 0 ? 'N' : 'S');
    addRationalArray(gpsEntries, 0x0002, createGpsRationals(payload.GPSLatitude));
    addAscii(gpsEntries, 0x0003, payload.GPSLongitude >= 0 ? 'E' : 'W');
    addRationalArray(gpsEntries, 0x0004, createGpsRationals(payload.GPSLongitude));
    if (typeof payload.GPSAltitude === 'number') {
      const altitude = payload.GPSAltitude;
      addByteArray(gpsEntries, 0x0005, new Uint8Array([altitude < 0 ? 1 : 0]));
      addRational(gpsEntries, 0x0006, toPositiveFraction(Math.abs(altitude)));
    }
  }

  const ifd0Size = calculateIFDSize(ifd0Entries);
  const exifSize = exifEntries.length ? calculateIFDSize(exifEntries) : 0;
  const gpsSize = gpsEntries.length ? calculateIFDSize(gpsEntries) : 0;

  ifd0Entries.forEach((entry) => {
    if (entry && entry.tag === 0x8769 && exifEntries.length) {
      entry.value = 8 + ifd0Size;
    }
    if (entry && entry.tag === 0x8825 && gpsEntries.length) {
      entry.value = 8 + ifd0Size + exifSize;
    }
  });

  const totalLength = 6 + 8 + ifd0Size + exifSize + gpsSize;
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  buffer.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], offset);
  offset += 6;
  buffer.set([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00], offset);
  offset += 8;

  const ifd0Buffer = buildIFD(ifd0Entries, littleEndian);
  buffer.set(ifd0Buffer.buffer, offset);
  offset += ifd0Buffer.buffer.length;

  if (exifEntries.length) {
    const exifBuffer = buildIFD(exifEntries, littleEndian);
    buffer.set(exifBuffer.buffer, offset);
    offset += exifBuffer.buffer.length;
  }

  if (gpsEntries.length) {
    const gpsBuffer = buildIFD(gpsEntries, littleEndian);
    buffer.set(gpsBuffer.buffer, offset);
  }

  return buffer;
}

function insertExifIntoPng(arrayBuffer, exifBinary) {
  const original = new Uint8Array(arrayBuffer);
  const signature = original.slice(0, 8);
  if (!isPngSignature(signature)) {
    throw new Error('无效的 PNG 文件');
  }
  let offset = 8;
  const chunks = [];
  chunks.push(signature);
  let inserted = false;

  while (offset < original.length) {
    const length = readUint32BE(original, offset);
    const type = getString(original, offset + 4, 4);
    const chunkTotal = 12 + length;
    const chunk = original.slice(offset, offset + chunkTotal);
    if (!inserted && type === 'IHDR') {
      chunks.push(chunk);
      const exifChunk = createPngExifChunk(exifBinary);
      chunks.push(exifChunk);
      inserted = true;
    } else if (type === 'eXIf') {
      // skip existing EXIF chunk
    } else {
      chunks.push(chunk);
    }
    offset += chunkTotal;
  }

  if (!inserted) {
    throw new Error('PNG 文件格式不正确');
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, cursor);
    cursor += chunk.length;
  });
  return output.buffer;
}

function stripExifFromPng(arrayBuffer) {
  const original = new Uint8Array(arrayBuffer);
  const signature = original.slice(0, 8);
  let offset = 8;
  const chunks = [];
  chunks.push(signature);
  while (offset < original.length) {
    const length = readUint32BE(original, offset);
    const type = getString(original, offset + 4, 4);
    const chunkTotal = 12 + length;
    if (type !== 'eXIf') {
      chunks.push(original.slice(offset, offset + chunkTotal));
    }
    offset += chunkTotal;
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, cursor);
    cursor += chunk.length;
  });
  return output.buffer;
}

function addAscii(store, tag, value) {
  if (!value) return;
  const bytes = textEncoder.encode(`${value}\0`);
  store.push({ tag, type: 2, count: bytes.length, bytes });
}

function addShort(store, tag, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setUint16(0, value, true);
  store.push({ tag, type: 3, count: 1, bytes: new Uint8Array(buffer) });
}

function addRational(store, tag, fraction) {
  if (!fraction) return;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, fraction.numerator >>> 0, true);
  view.setUint32(4, fraction.denominator >>> 0, true);
  store.push({ tag, type: 5, count: 1, bytes: new Uint8Array(buffer) });
}

function addRationalArray(store, tag, fractions) {
  if (!fractions || !fractions.length) return;
  const buffer = new ArrayBuffer(8 * fractions.length);
  const view = new DataView(buffer);
  fractions.forEach((fraction, index) => {
    view.setUint32(index * 8, fraction.numerator >>> 0, true);
    view.setUint32(index * 8 + 4, fraction.denominator >>> 0, true);
  });
  store.push({ tag, type: 5, count: fractions.length, bytes: new Uint8Array(buffer) });
}

function addByteArray(store, tag, bytes) {
  if (!bytes || !bytes.length) return;
  store.push({ tag, type: 1, count: bytes.length, bytes });
}

function addUndefined(store, tag, bytes) {
  if (!bytes || !bytes.length) return;
  store.push({ tag, type: 7, count: bytes.length, bytes });
}

function createPointerEntry(tag) {
  return { tag, type: 4, count: 1, value: 0 };
}

function buildIFD(entries, littleEndian) {
  const active = entries.filter(Boolean);
  const dataSize = active.reduce((sum, entry) => sum + alignTwo(entry.bytes ? entry.bytes.length : 0), 0);
  const bufferLength = 2 + active.length * 12 + 4 + dataSize;
  const buffer = new Uint8Array(bufferLength);
  const view = new DataView(buffer.buffer);
  view.setUint16(0, active.length, littleEndian);
  let entryOffset = 2;
  let dataOffset = 2 + active.length * 12 + 4;
  active.forEach((entry) => {
    view.setUint16(entryOffset, entry.tag, littleEndian);
    view.setUint16(entryOffset + 2, entry.type, littleEndian);
    view.setUint32(entryOffset + 4, entry.count, littleEndian);
    if (entry.bytes && entry.bytes.length) {
      view.setUint32(entryOffset + 8, dataOffset, littleEndian);
      buffer.set(entry.bytes, dataOffset);
      dataOffset += alignTwo(entry.bytes.length);
    } else {
      view.setUint32(entryOffset + 8, entry.value || 0, littleEndian);
    }
    entryOffset += 12;
  });
  return { buffer, length: buffer.length };
}

function calculateIFDSize(entries) {
  const active = entries.filter(Boolean);
  const dataSize = active.reduce((sum, entry) => sum + alignTwo(entry.bytes ? entry.bytes.length : 0), 0);
  return 2 + active.length * 12 + 4 + dataSize;
}

function alignTwo(length) {
  return length + (length % 2 === 0 ? 0 : 1);
}

function hasExifSection(payload) {
  return Boolean(
    payload.ExposureTime ||
    payload.FNumber ||
    payload.ISOSpeedRatings ||
    payload.FocalLength ||
    payload.LensModel ||
    payload.DateTime
  );
}

function hasGpsSection(payload) {
  return typeof payload.GPSLatitude === 'number' && typeof payload.GPSLongitude === 'number';
}

function parseFraction(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.numerator) return value;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.includes('/')) {
    const [num, den] = normalized.split('/').map((part) => Number(part));
    if (!Number.isNaN(num) && !Number.isNaN(den) && den !== 0) {
      return reduceFraction({ numerator: Math.round(num), denominator: Math.round(den) });
    }
  }
  const numeric = Number(normalized);
  if (Number.isNaN(numeric) || numeric === 0) return null;
  return approximateFraction(numeric);
}

function toPositiveFraction(value) {
  if (value === 0) return { numerator: 0, denominator: 1 };
  return approximateFraction(value);
}

function stripPrefix(value, prefix) {
  if (!value) return value;
  const text = String(value).trim();
  if (text.startsWith(prefix)) {
    return text.slice(prefix.length);
  }
  return text;
}

function stripSuffix(value, suffix) {
  if (!value) return value;
  const text = String(value).trim();
  if (text.toLowerCase().endsWith(suffix.toLowerCase())) {
    return text.slice(0, text.length - suffix.length);
  }
  return text;
}

function approximateFraction(number) {
  const sign = number < 0 ? -1 : 1;
  const abs = Math.abs(number);
  const denominator = 10000;
  const numerator = Math.round(abs * denominator);
  return reduceFraction({ numerator: numerator * sign, denominator });
}

function reduceFraction(fraction) {
  let { numerator, denominator } = fraction;
  if (denominator === 0) denominator = 1;
  if (numerator === 0) return { numerator: 0, denominator: 1 };
  const sign = numerator < 0 ? -1 : 1;
  numerator = Math.abs(numerator);
  let a = numerator;
  let b = denominator;
  while (b !== 0) {
    const temp = b;
    b = a % b;
    a = temp;
  }
  const gcd = a || 1;
  return { numerator: sign * (numerator / gcd), denominator: denominator / gcd };
}

function normalizeDateString(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return formatDate(value);
  }
  if (typeof value === 'string' && value.includes(':') && value.includes(' ')) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDate(parsed);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}:${month}:${day} ${hours}:${minutes}:${seconds}`;
}

function formatExposure(value) {
  if (!value) return '';
  if (value < 1 && value > 0) {
    return `1/${Math.round(1 / value)}`;
  }
  if (Number.isFinite(value)) {
    return value.toFixed(3).replace(/\.0+$/, '');
  }
  return value;
}

function convertGpsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length !== 3) return null;
  const [degrees, minutes, seconds] = dms;
  const decimal = degrees + minutes / 60 + seconds / 3600;
  if (ref === 'S' || ref === 'W') {
    return -decimal;
  }
  return decimal;
}

function createGpsRationals(decimal) {
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  return [degrees, minutes, seconds].map((value) => {
    if (value === 0) return { numerator: 0, denominator: 1 };
    return approximateFraction(value);
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function dataURLToFile(dataURL, originalFile) {
  const [header, data] = dataURL.split(',');
  const mimeMatch = header.match(/data:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : originalFile.type;
  const byteString = atob(data);
  const buffer = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i += 1) {
    buffer[i] = byteString.charCodeAt(i);
  }
  return new File([buffer], originalFile.name, {
    type: mime,
    lastModified: Date.now()
  });
}

function readUint32BE(array, offset) {
  return (array[offset] << 24) | (array[offset + 1] << 16) |
         (array[offset + 2] << 8) | array[offset + 3];
}

function getString(array, offset, length) {
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += String.fromCharCode(array[offset + i]);
  }
  return result;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function createPngExifChunk(exifBinary) {
  const typeBytes = textEncoder.encode('eXIf');
  const lengthBytes = new Uint8Array(4);
  const view = new DataView(lengthBytes.buffer);
  view.setUint32(0, exifBinary.length, false);
  const crcInput = new Uint8Array(typeBytes.length + exifBinary.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(exifBinary, typeBytes.length);
  const crcValue = crc32(crcInput);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crcValue >>> 0, false);
  const chunk = new Uint8Array(12 + exifBinary.length);
  chunk.set(lengthBytes, 0);
  chunk.set(typeBytes, 4);
  chunk.set(exifBinary, 8);
  chunk.set(crcBytes, 8 + exifBinary.length);
  return chunk;
}

function isJpeg(file) {
  return file.type === 'image/jpeg';
}

function isPng(file) {
  return file.type === 'image/png';
}

function isPngSignature(bytes) {
  if (!bytes || bytes.length !== 8) return false;
  const reference = [137, 80, 78, 71, 13, 10, 26, 10];
  return reference.every((value, index) => bytes[index] === value);
}
