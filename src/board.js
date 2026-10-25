export const RESOURCES = ['wood', 'brick', 'wool', 'wheat', 'ore'];
export const RESOURCE_NAMES = { wood: 'Bois', brick: 'Argile', wool: 'Laine', wheat: 'Blé', ore: 'Minerai' };
export const RESOURCE_ICONS = { wood: '♠', brick: '▰', wool: '❋', wheat: '♜', ore: '◆' };
export const COLORS = ['#d97148', '#4e8eac', '#a69c48', '#9b7bb1'];
export const emptyResources = (value = 0) => Object.fromEntries(RESOURCES.map(r => [r, value]));

export function hashSeed(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function random(holder) {
  holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffle(array, holder) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random(holder) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function makeBoard(seed) {
  const holder = { rng: hashSeed(seed) };
  const terrains = shuffle(['desert', ...Array(4).fill('wood'), ...Array(4).fill('wool'),
    ...Array(4).fill('wheat'), ...Array(3).fill('brick'), ...Array(3).fill('ore')], holder);
  const hexes = [], vertices = [], edges = [], vertexMap = new Map(), edgeMap = new Map();
  const radius = 58;
  for (let r = -2; r <= 2; r++) {
    for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q++) {
      const id = hexes.length, x = Math.sqrt(3) * radius * (q + r / 2), y = radius * 1.5 * r;
      const corners = [];
      for (let i = 0; i < 6; i++) {
        const angle = (60 * i - 30) * Math.PI / 180;
        const vx = x + radius * Math.cos(angle), vy = y + radius * Math.sin(angle);
        const key = `${Math.round(vx * 100)},${Math.round(vy * 100)}`;
        if (!vertexMap.has(key)) {
          vertexMap.set(key, vertices.length);
          vertices.push({ id: vertices.length, x: vx, y: vy, hexes: [], edges: [], neighbors: [], owner: null, building: null });
        }
        const vid = vertexMap.get(key);
        vertices[vid].hexes.push(id);
        corners.push(vid);
      }
      const sides = [];
      for (let i = 0; i < 6; i++) {
        const a = corners[i], b = corners[(i + 1) % 6], key = [a, b].sort((v, w) => v - w).join('-');
        if (!edgeMap.has(key)) {
          const eid = edges.length;
          edgeMap.set(key, eid);
          edges.push({ id: eid, a, b, hexes: [], owner: null });
          vertices[a].edges.push(eid); vertices[b].edges.push(eid);
          vertices[a].neighbors.push(b); vertices[b].neighbors.push(a);
        }
        const eid = edgeMap.get(key);
        edges[eid].hexes.push(id);
        sides.push(eid);
      }
      hexes.push({ id, q, r, x, y, terrain: terrains[id], number: null, vertices: corners, edges: sides });
    }
  }
  const tokens = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  let valid = false;
  for (let attempt = 0; attempt < 10000 && !valid; attempt++) {
    const numbers = shuffle(tokens, holder);
    hexes.forEach(h => { h.number = h.terrain === 'desert' ? null : numbers.pop(); });
    valid = edges.every(e => e.hexes.length !== 2 || !e.hexes.every(id => [6, 8].includes(hexes[id].number)));
  }
  if (!valid) throw new Error('Impossible de créer un plateau équilibré.');
  const coastline = edges.filter(e => e.hexes.length === 1).sort((a, b) => {
    const angle = e => Math.atan2(vertices[e.a].y + vertices[e.b].y, vertices[e.a].x + vertices[e.b].x);
    return angle(a) - angle(b);
  });
  const types = shuffle([null, null, null, null, ...RESOURCES], holder);
  const ports = [0, 3, 6, 10, 13, 16, 20, 23, 26].map((n, id) => {
    const edge = coastline[n];
    return { id, vertices: [edge.a, edge.b], resource: types[id] };
  });
  return { hexes, vertices, edges, ports };
}

export function vertexValue(board, id) {
  const v = board.vertices[id];
  const productive = v.hexes.map(i => board.hexes[i]).filter(h => h.number);
  return productive.reduce((sum, h) => sum + (6 - Math.abs(7 - h.number)), 0)
    + new Set(productive.map(h => h.terrain)).size * 0.8;
}
