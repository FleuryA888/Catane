import { RESOURCE_NAMES } from './board.js';

const round = n => Number(n.toFixed(2));
const point = v => `${round(v.x)},${round(v.y)}`;
const button = (action, id, label, content, className = '') => `<g class="board-target ${className}" role="button" tabindex="0" data-action="${action}" data-id="${id}" aria-label="${label}"><title>${label}</title>${content}</g>`;

export function boardSVG(state, { kind = null, legal = [], interactive = false } = {}) {
  const { board } = state, active = new Set(legal);
  const tiles = board.hexes.map(h => {
    const points = h.vertices.map(i => point(board.vertices[i])).join(' ');
    const name = h.terrain === 'desert' ? 'Désert' : RESOURCE_NAMES[h.terrain];
    const label = `${name}${h.number ? `, ${h.number}` : ''}${h.id === state.robber ? ', voleur présent' : ''}`;
    const tile = `<polygon class="hex ${h.terrain}" points="${points}"/><polygon class="hex-grain" fill="url(#grain)" points="${points}"/>
      <g transform="translate(${round(h.x)},${round(h.y)})" class="terrain-decoration"><use href="#terrain-${h.terrain}"/></g>
      ${h.number ? `<g class="number-token ${[6, 8].includes(h.number) ? 'hot' : ''}" transform="translate(${round(h.x)},${round(h.y + 5)})"><circle r="17"/><text y="2">${h.number}</text><text class="probability" y="12">${'•'.repeat(6 - Math.abs(7 - h.number))}</text></g>` : `<text class="desert-label" x="${round(h.x)}" y="${round(h.y + 18)}">DÉSERT</text>`}
      ${h.id === state.robber ? `<g class="robber" transform="translate(${round(h.x)},${round(h.y - 21)})"><ellipse cy="12" rx="10" ry="3" fill="#143340" opacity=".3"/><path d="M-8 10Q-8 0-4-3A6 6 0 1 1 4-3Q8 0 8 10Z" fill="#233d44" stroke="#eee2c4" stroke-width="1.5"/><circle cy="-8" r="2" fill="#a7b6ae"/></g>` : ''}`;
    return interactive && kind === 'robber' && h.id !== state.robber ? button('hex', h.id, `Déplacer le voleur : ${label}`, tile, 'hex-selectable') : `<g><title>${label}</title>${tile}</g>`;
  }).join('');
  const ports = board.ports.map(p => {
    const a = board.vertices[p.vertices[0]], b = board.vertices[p.vertices[1]], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const length = Math.hypot(mx, my), x = mx + mx / length * 34, y = my + my / length * 34;
    const label = p.resource ? `Port ${RESOURCE_NAMES[p.resource]} 2 contre 1` : 'Port général 3 contre 1';
    return `<g class="port"><title>${label}</title><path d="M${point(a)}L${round(x)},${round(y)}L${point(b)}"/><circle cx="${round(x)}" cy="${round(y)}" r="16"/><text x="${round(x)}" y="${round(y - 1)}">${p.resource ? '2:1' : '3:1'}</text><text class="port-type" x="${round(x)}" y="${round(y + 9)}">${p.resource ? RESOURCE_NAMES[p.resource].toUpperCase() : 'TOUT'}</text></g>`;
  }).join('');
  const paths = board.edges.map(e => {
    const a = board.vertices[e.a], b = board.vertices[e.b];
    const line = `x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}"`;
    if (e.owner !== null) return `<g class="road-piece"><title>Route · ${escapeHTML(state.players[e.owner].name)}</title><line ${line} stroke="#25404b" stroke-width="10"/><line ${line} stroke="${state.players[e.owner].color}" stroke-width="7"/><line ${line} stroke="#ffffff" stroke-opacity=".25" stroke-width="1.3" transform="translate(0,-1.5)"/></g>`;
    if (interactive && kind === 'road' && active.has(e.id)) return button('edge', e.id, `Construire la route ${e.id + 1}`, `<line ${line} class="road-hit"/><line ${line} class="road-ghost"/>`);
    return '';
  }).join('');
  const buildings = board.vertices.map(v => {
    if (v.owner === null && !(interactive && kind === 'settlement' && active.has(v.id))) return '';
    const transform = `translate(${round(v.x)},${round(v.y)})`;
    if (v.owner === null) return button('vertex', v.id, `Fonder une colonie à l’intersection ${v.id + 1}`, `<g transform="${transform}"><circle class="settlement-hit" r="12"/><path d="M-4 0H4M0-4V4" class="plus"/></g>`);
    const city = v.building === 'city';
    const shape = `<g transform="${transform}" class="building-piece"><ellipse cy="6" rx="12" ry="4" fill="#173f48" opacity=".25"/><path d="${city ? 'M-12 6V-3L-6-9 0-3V-11L6-17 12-11V6Z' : 'M-9 6V-5L0-13 9-5V6Z'}" fill="${state.players[v.owner].color}" stroke="#fff2d5" stroke-width="1.8"/><path d="M-2 6V-1H2V6" fill="#1d3943" opacity=".7"/>${city ? '<path d="M4-8H8V-4H4Z" fill="#fff2d5"/>' : ''}</g>`;
    return interactive && kind === 'city' && active.has(v.id) ? button('vertex', v.id, `Transformer la colonie ${v.id + 1} en ville`, shape, 'city-selectable') : `<g><title>${city ? 'Ville' : 'Colonie'} · ${escapeHTML(state.players[v.owner].name)}</title>${shape}</g>`;
  }).join('');
  return `<svg class="island-svg" viewBox="-330 -292 660 584" role="group" aria-label="Plateau de Catane : 19 terrains, 9 ports et les constructions des joueurs">
    <defs>
      <pattern id="grain" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".6" fill="#fff" opacity=".13"/><path d="M7 7h2" stroke="#1d3943" stroke-opacity=".08"/></pattern>
      <g id="terrain-wood" fill="#295d45" stroke="#285540" stroke-width="1"><path d="M-37-18l8-17 8 17h-5v7h-6v-7ZM17 26l8-17 8 17h-5v7h-6v-7ZM13-28l7-15 7 15h-4v6h-6v-6Z"/><path d="M-25 32l7-15 7 15h-4v5h-6v-5Z"/></g>
      <g id="terrain-brick" fill="#aa583a" stroke="#e6a877" stroke-width="1"><path d="M-38-18l13-13 14 16-12 4ZM13 26l12-16 15 14-10 6ZM14-32l10-7 11 11-15 2ZM-28 31l9-7 9 9-13 3Z"/></g>
      <g id="terrain-wool" fill="#f1edd5"><g transform="translate(-27,-23)"><ellipse rx="8" ry="5"/><circle cx="7" cy="1" r="3" fill="#567248"/></g><g transform="translate(28,24)"><ellipse rx="8" ry="5"/><circle cx="7" cy="1" r="3" fill="#567248"/></g><path d="M-25 28l3-6 3 6m35-60 3-6 3 6" stroke="#608643" stroke-width="2" fill="none"/></g>
      <g id="terrain-wheat" stroke="#b78b33" stroke-width="1.5" fill="none"><path d="M-29-13v-23m-4 5 4 3 4-3m-8 9 4 3 4-3M26 36V13m-4 5 4 3 4-3m-8 9 4 3 4-3M22-27v-14m-4 4 4 3 4-3M-22 35V23m-4 4 4 3 4-3"/></g>
      <g id="terrain-ore" stroke="#6a7d7d" stroke-width="1" fill="#aeb7ab"><path d="M-40-17l12-19 15 22ZM13 27l13-22 17 24ZM15-28l9-15 13 18ZM-28 35l9-14 9 15Z"/><path d="m-32-29 4-7 5 7m45 31 4-7 5 7" fill="#e2e2cb" stroke="none"/></g>
      <g id="terrain-desert" fill="none" stroke="#c9a774" stroke-width="1.5"><path d="M-35-13q12-12 25 0m15 40q15-13 30-2M14-32q9-9 19-1M-28 29q7-5 13 0"/></g>
    </defs>
    <ellipse class="island-shadow" cy="12" rx="270" ry="240"/>
    <g class="sea-waves" fill="none"><path d="M-310-125q15-8 30 0m-15 7q15-8 30 0M259 104q15-8 30 0m-17 8q15-8 30 0M110-262q15-8 30 0M-132 256q15-8 30 0"/><circle r="276" stroke-dasharray="2 13" opacity=".2"/></g>
    ${ports}${tiles}${paths}${buildings}
    <g class="compass" transform="translate(282,-235)"><text y="-23">N</text><path d="M0-17 5 0 0 17-5 0Z"/><path d="M-13 0H13M0-17V17"/></g>
    <text class="sea-caption" x="-277" y="271">MER DES POSSIBLES</text>
  </svg>`;
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
