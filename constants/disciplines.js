const DISCIPLINE_REGISTRY = Object.freeze([
  Object.freeze({ slug: 'rap', label: 'Rap', aliases: ['rap battle', 'hip hop'] }),
  Object.freeze({ slug: 'dancehall', label: 'Dancehall', aliases: ['shatta'] }),
  Object.freeze({ slug: 'reggae', label: 'Reggae', aliases: [] }),
  Object.freeze({ slug: 'tradi-moderne', label: 'Musique tradi-moderne', aliases: ['musique tradi moderne', 'tradimoderne', 'tradi moderne'] }),
  Object.freeze({ slug: 'comedie', label: 'Comedie', aliases: ['comedy', 'one man show', 'humour'] }),
]);

const DEFAULT_DISCIPLINE_SLUG = 'rap';

const disciplineBySlug = DISCIPLINE_REGISTRY.reduce((accumulator, discipline) => {
  accumulator[discipline.slug] = discipline;
  return accumulator;
}, {});

const aliasToSlug = DISCIPLINE_REGISTRY.reduce((accumulator, discipline) => {
  accumulator[discipline.slug] = discipline.slug;
  for (const alias of discipline.aliases) {
    accumulator[alias] = discipline.slug;
  }
  accumulator[discipline.label.toLowerCase()] = discipline.slug;
  return accumulator;
}, {});

const normalizeDisciplineSlug = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  return aliasToSlug[normalized] || null;
};

const normalizeDisciplineList = (value, { fallback = [] } = {}) => {
  const rawValues = Array.isArray(value)
    ? value
    : value == null
    ? []
    : [value];

  const normalized = [];
  const seen = new Set();

  for (const item of rawValues) {
    const slug = normalizeDisciplineSlug(item);
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    normalized.push(slug);
  }

  if (normalized.length > 0) {
    return normalized;
  }

  const fallbackValues = Array.isArray(fallback)
    ? fallback.filter(Boolean)
    : fallback == null
    ? []
    : [fallback];

  if (fallbackValues.length === 0) {
    return [];
  }

  return normalizeDisciplineList(fallbackValues, { fallback: [] });
};

const buildDisciplinePayload = (input, { fallback = [DEFAULT_DISCIPLINE_SLUG] } = {}) => {
  const categories = normalizeDisciplineList(input, { fallback });

  return {
    categories,
    primaryCategory: categories[0] || DEFAULT_DISCIPLINE_SLUG,
  };
};

module.exports = {
  DEFAULT_DISCIPLINE_SLUG,
  DISCIPLINE_REGISTRY,
  buildDisciplinePayload,
  disciplineBySlug,
  normalizeDisciplineList,
  normalizeDisciplineSlug,
};