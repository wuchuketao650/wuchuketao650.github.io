const FIELD_IDS = {
  make: 'Make',
  model: 'Model',
  datetime: 'DateTime',
  description: 'ImageDescription',
  artist: 'Artist',
  copyright: 'Copyright',
  orientation: 'Orientation',
  fnumber: 'FNumber',
  exposure: 'ExposureTime',
  iso: 'ISOSpeedRatings',
  focal: 'FocalLength',
  lens: 'LensModel',
  latitude: 'GPSLatitude',
  longitude: 'GPSLongitude',
  altitude: 'GPSAltitude'
};

export function createExifForm() {
  const refs = Object.keys(FIELD_IDS).reduce((acc, key) => {
    acc[key] = document.getElementById(key);
    return acc;
  }, {});

  return {
    populate,
    clear,
    collect,
    setGPS,
    clearGPS
  };

  function populate(data = {}) {
    Object.entries(refs).forEach(([key, input]) => {
      if (!input) return;
      const fieldName = FIELD_IDS[key];
      const value = data[fieldName];
      if (key === 'datetime') {
        input.value = formatExifDateForInput(value) || '';
      } else if (key === 'latitude' || key === 'longitude') {
        input.value = typeof value === 'number' ? value.toFixed(6) : '';
      } else if (key === 'altitude') {
        input.value = typeof value === 'number' ? value : '';
      } else if (key === 'iso' || key === 'orientation') {
        input.value = value ?? '';
      } else {
        input.value = value || '';
      }
    });
  }

  function clear() {
    Object.values(refs).forEach((input) => {
      if (input) input.value = '';
    });
  }

  function collect() {
    return {
      Make: getText('make'),
      Model: getText('model'),
      DateTime: formatInputDateForExif(getText('datetime')),
      ImageDescription: getText('description'),
      Artist: getText('artist'),
      Copyright: getText('copyright'),
      Orientation: getNumber('orientation'),
      FNumber: getText('fnumber'),
      ExposureTime: getText('exposure'),
      ISOSpeedRatings: getNumber('iso'),
      FocalLength: getText('focal'),
      LensModel: getText('lens'),
      GPSLatitude: getFloat('latitude'),
      GPSLongitude: getFloat('longitude'),
      GPSAltitude: getFloat('altitude')
    };
  }

  function setGPS(lat, lng, altitude) {
    if (refs.latitude) refs.latitude.value = typeof lat === 'number' ? lat.toFixed(6) : '';
    if (refs.longitude) refs.longitude.value = typeof lng === 'number' ? lng.toFixed(6) : '';
    if (refs.altitude && typeof altitude === 'number') {
      refs.altitude.value = altitude;
    }
  }

  function clearGPS() {
    if (refs.latitude) refs.latitude.value = '';
    if (refs.longitude) refs.longitude.value = '';
    if (refs.altitude) refs.altitude.value = '';
  }

  function getText(key) {
    const input = refs[key];
    return input ? input.value.trim() : '';
  }

  function getNumber(key) {
    const value = getText(key);
    if (value === '') return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function getFloat(key) {
    const value = getText(key);
    if (!value) return null;
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}

function formatExifDateForInput(value) {
  if (!value || typeof value !== 'string') return '';
  const parts = value.split(' ');
  if (parts.length !== 2) return '';
  const date = parts[0].replace(/:/g, '-');
  return `${date}T${parts[1].slice(0, 5)}`;
}

function formatInputDateForExif(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}:${month}:${day} ${hours}:${minutes}:${seconds}`;
}
