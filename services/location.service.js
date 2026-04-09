const CITY_REGION_PAIRS = [
  ['Ouagadougou', 'Centre'],
  ['Bobo-Dioulasso', 'Hauts-Bassins'],
  ['Koudougou', 'Centre-Ouest'],
  ['Banfora', 'Cascades'],
  ['Ouahigouya', 'Nord'],
  ['Fada N\'Gourma', 'Est'],
  ['Dori', 'Sahel'],
  ['Dédougou', 'Boucle du Mouhoun'],
  ['Gaoua', 'Sud-Ouest'],
  ['Tenkodogo', 'Centre-Est'],
  ['Kaya', 'Centre-Nord'],
  ['Manga', 'Centre-Sud'],
  ['Ziniaré', 'Plateau-Central'],
];

const normalizeLocationKey = (value) => (value || '')
  .toString()
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s']/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const titleCaseWord = (word) => word
  .split("'")
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join("'");

const formatLabel = (value) => normalizeLocationKey(value)
  .split(' ')
  .filter(Boolean)
  .map(titleCaseWord)
  .join(' ');

const CITY_TO_REGION = CITY_REGION_PAIRS.reduce((accumulator, [city, region]) => {
  accumulator[normalizeLocationKey(city)] = region;
  return accumulator;
}, {});

const CANONICAL_CITIES = CITY_REGION_PAIRS.reduce((accumulator, [city]) => {
  accumulator[normalizeLocationKey(city)] = city;
  return accumulator;
}, {});

const CANONICAL_REGIONS = [...new Set(CITY_REGION_PAIRS.map(([, region]) => region))].reduce(
  (accumulator, region) => {
    accumulator[normalizeLocationKey(region)] = region;
    return accumulator;
  },
  {}
);

const canonicalCity = (value) => {
  const key = normalizeLocationKey(value);
  return key ? CANONICAL_CITIES[key] || null : null;
};

const canonicalRegion = (value) => {
  const key = normalizeLocationKey(value);
  return key ? CANONICAL_REGIONS[key] || null : null;
};

const resolveRegionFromCity = (city) => {
  const key = normalizeLocationKey(city);
  return key ? CITY_TO_REGION[key] || null : null;
};

const normalizeNeighborhood = (value) => {
  const formatted = formatLabel(value);
  return formatted || null;
};

const normalizeBurkinaProfile = ({ city, neighborhood, region, currentProfile = {} }) => {
  const nextCityRaw = city === undefined ? currentProfile.city : city;
  const nextNeighborhoodRaw = neighborhood === undefined ? currentProfile.neighborhood : neighborhood;
  const nextRegionRaw = region === undefined ? currentProfile.region : region;

  const normalizedCity = nextCityRaw ? canonicalCity(nextCityRaw) : null;
  if (nextCityRaw && !normalizedCity) {
    throw new Error('Ville non reconnue. Choisissez une ville valide du Burkina Faso.');
  }

  const normalizedRegionInput = nextRegionRaw ? canonicalRegion(nextRegionRaw) : null;
  if (nextRegionRaw && !normalizedRegionInput) {
    throw new Error('Région non reconnue.');
  }

  if (nextNeighborhoodRaw && !normalizedCity) {
    throw new Error('Choisissez une ville avant de renseigner le quartier.');
  }

  const normalizedNeighborhood = nextNeighborhoodRaw
    ? normalizeNeighborhood(nextNeighborhoodRaw)
    : null;

  const inferredRegion = normalizedCity ? resolveRegionFromCity(normalizedCity) : null;
  if (normalizedCity && normalizedRegionInput && inferredRegion !== normalizedRegionInput) {
    throw new Error('La région ne correspond pas à la ville sélectionnée.');
  }

  return {
    city: normalizedCity,
    neighborhood: normalizedNeighborhood,
    region: inferredRegion || normalizedRegionInput,
    country: 'Burkina Faso',
  };
};

module.exports = {
  CITY_REGION_PAIRS,
  canonicalCity,
  canonicalRegion,
  formatLabel,
  normalizeBurkinaProfile,
  normalizeLocationKey,
  normalizeNeighborhood,
  resolveRegionFromCity,
};