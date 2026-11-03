// Hash routes for the browser client. Pure: Node tests import this module.
// Route parameters come from the address bar and are treated as data; views
// look them up through the hub, they never select code or markup.

export const DEFAULT_HASH = '#/discover';
const PARAM_MAX = 512;

// [name, path segments]; a segment starting with ':' is a parameter.
const TABLE = Object.freeze([
  ['discover', ['discover']],
  ['projects', ['projects']],
  ['profile', ['profile']],
  ['brief', ['brief', ':id']],
  ['project', ['project', ':pid']],
  ['person', ['people', ':id']],
]);

export const ROUTE_NAMES = Object.freeze(TABLE.map(([name]) => name));

const notFound = (path) => ({ name: 'notfound', params: { path } });

// Returns {name, params}, with `redirect` when the address should be replaced,
// or null for an in-page anchor such as "#main" that is not a route.
export function parseRoute(hash) {
  if (typeof hash !== 'string') return null;
  if (hash === '' || hash === '#' || hash === '#/') return { name: 'discover', params: {}, redirect: DEFAULT_HASH };
  if (!hash.startsWith('#/')) return null;
  const path = hash.slice(2).split('?')[0];
  if (path.length > 2048) return notFound(path.slice(0, 64));
  let segments;
  try {
    segments = path.split('/').filter((s) => s !== '').map(decodeURIComponent);
  } catch {
    return notFound(path);
  }
  for (const [name, pattern] of TABLE) {
    if (pattern.length !== segments.length) continue;
    const params = {};
    const matches = pattern.every((seg, i) => {
      const value = segments[i];
      if (!seg.startsWith(':')) return seg === value;
      if (value.length > PARAM_MAX || /[\u0000-\u001f\u007f]/.test(value)) return false;
      params[seg.slice(1)] = value;
      return true;
    });
    if (matches) return { name, params };
  }
  return notFound(path);
}

export function href(name, params = {}) {
  const entry = TABLE.find(([n]) => n === name);
  if (!entry) throw new Error(`Unknown route: ${name}`);
  const segments = entry[1].map((seg) => {
    if (!seg.startsWith(':')) return seg;
    const value = params[seg.slice(1)];
    if (typeof value !== 'string' || value === '') throw new Error(`Route ${name} needs a ${seg.slice(1)} parameter`);
    return encodeURIComponent(value);
  });
  return `#/${segments.join('/')}`;
}
