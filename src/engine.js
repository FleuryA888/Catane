import { RESOURCES, COLORS, emptyResources, makeBoard, hashSeed, shuffle, random } from './board.js';

export const COSTS = {
  road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, wool: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 }, development: { wool: 1, wheat: 1, ore: 1 }
};
export const DEVELOPMENT_NAMES = { knight: 'Chevalier', roadBuilding: 'Construction de routes', plenty: 'Invention', monopoly: 'Monopole', victory: 'Point de victoire' };
export const DEVELOPMENT_COUNTS = { knight: 14, roadBuilding: 2, plenty: 2, monopoly: 2, victory: 5 };
export class RuleError extends Error {}
const requireRule = (condition, message) => { if (!condition) throw new RuleError(message); };
export const resourceCount = resources => RESOURCES.reduce((n, r) => n + resources[r], 0);
export const canAfford = (player, cost) => Object.entries(cost).every(([r, n]) => player.resources[r] >= n);

export function createGame({ names = ['Capitaine', 'Éloïse', 'Gabriel'], bots = [false, true, true], seed = String(Date.now()) } = {}) {
  requireRule(Array.isArray(names) && [3, 4].includes(names.length), 'Il faut 3 ou 4 joueurs.');
  requireRule(typeof seed === 'string' && seed.length > 0 && seed.length <= 100, 'La graine doit contenir 1 à 100 caractères.');
  requireRule(names.every(n => typeof n === 'string' && n.trim().length > 0 && n.trim().length <= 24), 'Choisissez des noms de 1 à 24 caractères.');
  const holder = { rng: hashSeed(seed + ':cards') };
  const deck = shuffle(Object.entries(DEVELOPMENT_COUNTS).flatMap(([type, n]) => Array(n).fill(type)), holder);
  const board = makeBoard(seed);
  return {
    version: 1, seed, rng: holder.rng, board,
    players: names.map((name, id) => ({ id, name: name.trim(), color: COLORS[id], bot: Boolean(bots[id]), resources: emptyResources(), development: [], knights: 0 })),
    bank: emptyResources(19), deck, usedDevelopment: [], current: 0, turn: 0, phase: 'setupSettlement',
    setupOrder: [...names.keys(), ...[...names.keys()].reverse()], setupIndex: 0, setupVertex: null,
    dice: null, playedDevelopment: false, freeRoads: 0, resumePhase: null, discards: [], victims: [], offer: null,
    robber: board.hexes.find(h => h.terrain === 'desert').id,
    awards: { road: null, army: null }, winner: null, log: ['Bienvenue sur l’île. Placez vos deux colonies et leurs routes.']
  };
}

export function pieces(state, player = state.current) {
  return {
    roads: state.board.edges.filter(e => e.owner === player).length,
    settlements: state.board.vertices.filter(v => v.owner === player && v.building === 'settlement').length,
    cities: state.board.vertices.filter(v => v.owner === player && v.building === 'city').length
  };
}

export function distanceFree(state, vertex) {
  const v = state.board.vertices[vertex];
  return Boolean(v && v.owner === null && v.neighbors.every(id => state.board.vertices[id].owner === null));
}

export function canPlaceRoad(state, edge, player = state.current, setup = false) {
  const e = state.board.edges[edge];
  if (!e || e.owner !== null || pieces(state, player).roads >= 15) return false;
  if (setup) return [e.a, e.b].includes(state.setupVertex);
  return [e.a, e.b].some(id => {
    const v = state.board.vertices[id];
    return v.owner === player || (v.owner === null && v.edges.some(i => state.board.edges[i].owner === player));
  });
}

export function legalSites(state, kind, player = state.current) {
  if (kind === 'road') return state.board.edges.filter(e => canPlaceRoad(state, e.id, player, state.phase === 'setupRoad')).map(e => e.id);
  if (kind === 'settlement') {
    if (pieces(state, player).settlements >= 5) return [];
    return state.board.vertices.filter(v => distanceFree(state, v.id) &&
      (state.phase === 'setupSettlement' || v.edges.some(i => state.board.edges[i].owner === player))).map(v => v.id);
  }
  if (kind === 'city') return pieces(state, player).cities >= 4 ? [] : state.board.vertices.filter(v => v.owner === player && v.building === 'settlement').map(v => v.id);
  return [];
}

// Explore trails, not just a tree diameter: cycles count, forks cannot reuse an edge.
export function longestRoad(state, player) {
  const { vertices, edges } = state.board;
  const walk = (vertex, used) => {
    if (used.size && vertices[vertex].owner !== null && vertices[vertex].owner !== player) return used.size;
    let best = used.size;
    for (const id of vertices[vertex].edges) {
      const e = edges[id];
      if (e.owner !== player || used.has(id)) continue;
      used.add(id);
      best = Math.max(best, walk(e.a === vertex ? e.b : e.a, used));
      used.delete(id);
    }
    return best;
  };
  return Math.max(0, ...vertices.filter(v => v.edges.some(id => edges[id].owner === player)).map(v => walk(v.id, new Set())));
}

function updateAwards(state) {
  for (const [award, minimum, values] of [
    ['road', 5, state.players.map(p => longestRoad(state, p.id))],
    ['army', 3, state.players.map(p => p.knights)]
  ]) {
    const max = Math.max(...values), old = state.awards[award];
    const leaders = state.players.filter(p => values[p.id] === max && max >= minimum).map(p => p.id);
    state.awards[award] = leaders.includes(old) ? old : leaders.length === 1 ? leaders[0] : null;
    if (state.awards[award] !== old && state.awards[award] !== null) log(state, `${state.players[state.awards[award]].name} obtient ${award === 'road' ? 'la Route la plus longue' : 'l’Armée la plus puissante'} (+2 PV).`);
  }
}

export function score(state, player, includeHidden = true) {
  const stock = pieces(state, player);
  return stock.settlements + stock.cities * 2 + (state.awards.road === player ? 2 : 0) + (state.awards.army === player ? 2 : 0)
    + (includeHidden ? state.players[player].development.filter(c => c.type === 'victory').length : 0);
}

export function tradeRate(state, player, resource) {
  const ports = state.board.ports.filter(p => p.vertices.some(v => state.board.vertices[v].owner === player));
  return ports.some(p => p.resource === resource) ? 2 : ports.some(p => p.resource === null) ? 3 : 4;
}

function log(state, message) { state.log = [...state.log.slice(-99), message]; }
function pay(state, player, cost) {
  requireRule(canAfford(state.players[player], cost), 'Vous n’avez pas les ressources nécessaires.');
  for (const [r, n] of Object.entries(cost)) { state.players[player].resources[r] -= n; state.bank[r] += n; }
}
function transferFromBank(state, player, resource, quantity) {
  state.bank[resource] -= quantity; state.players[player].resources[resource] += quantity;
}
function resourceBag(value) {
  requireRule(value && typeof value === 'object' && !Array.isArray(value), 'Sélection de ressources invalide.');
  requireRule(Object.keys(value).every(k => RESOURCES.includes(k)), 'Ressource inconnue.');
  const bag = { ...emptyResources(), ...value };
  requireRule(RESOURCES.every(r => Number.isInteger(bag[r]) && bag[r] >= 0 && bag[r] <= 19), 'Quantité de ressources invalide.');
  return bag;
}

function produce(state, total) {
  const claims = state.players.map(() => emptyResources());
  for (const h of state.board.hexes) {
    if (h.number !== total || h.id === state.robber || h.terrain === 'desert') continue;
    for (const id of h.vertices) {
      const v = state.board.vertices[id];
      if (v.owner !== null) claims[v.owner][h.terrain] += v.building === 'city' ? 2 : 1;
    }
  }
  for (const r of RESOURCES) {
    const totalClaim = claims.reduce((n, bag) => n + bag[r], 0);
    const recipients = state.players.filter(p => claims[p.id][r] > 0);
    if (totalClaim <= state.bank[r]) recipients.forEach(p => transferFromBank(state, p.id, r, claims[p.id][r]));
    else if (recipients.length === 1) transferFromBank(state, recipients[0].id, r, state.bank[r]);
    else log(state, `La banque manque de ${r === 'wool' ? 'laine' : r === 'wood' ? 'bois' : r === 'brick' ? 'argile' : r === 'wheat' ? 'blé' : 'minerai'} : aucune distribution de cette ressource.`);
  }
}

export function decisionPlayer(state) {
  return state.phase === 'discard' ? state.discards[0].player : state.phase === 'trade' ? state.offer.target : state.current;
}

function finishRoads(state) {
  if (state.freeRoads === 0 || legalSites(state, 'road').length === 0) {
    state.freeRoads = 0; state.phase = state.resumePhase; state.resumePhase = null;
  }
}

export function act(previous, action) {
  requireRule(previous.phase !== 'finished', 'La partie est terminée.');
  requireRule(action && typeof action.type === 'string', 'Action invalide.');
  const state = structuredClone(previous), p = state.players[state.current];
  const phase = (...phases) => requireRule(phases.includes(state.phase), 'Cette action n’est pas disponible maintenant.');
  switch (action.type) {
    case 'BUILD_SETTLEMENT': {
      phase('setupSettlement', 'actions');
      requireRule(legalSites(state, 'settlement').includes(action.vertex), 'Colonie impossible ici : respectez la distance et votre réseau.');
      const setup = state.phase === 'setupSettlement';
      if (!setup) pay(state, p.id, COSTS.settlement);
      Object.assign(state.board.vertices[action.vertex], { owner: p.id, building: 'settlement' });
      log(state, `${p.name} fonde une colonie.`);
      if (setup) {
        state.setupVertex = action.vertex;
        if (state.setupIndex >= state.players.length) {
          for (const id of state.board.vertices[action.vertex].hexes) {
            const r = state.board.hexes[id].terrain;
            if (r !== 'desert' && state.bank[r] > 0) transferFromBank(state, p.id, r, 1);
          }
        }
        state.phase = 'setupRoad';
      }
      break;
    }
    case 'BUILD_ROAD': {
      phase('setupRoad', 'actions', 'roadBuilding');
      requireRule(legalSites(state, 'road').includes(action.edge), 'Cette route doit prolonger votre réseau sans traverser une colonie adverse.');
      if (state.phase === 'actions') pay(state, p.id, COSTS.road);
      state.board.edges[action.edge].owner = p.id;
      log(state, `${p.name} construit une route.`);
      if (state.phase === 'setupRoad') {
        state.setupIndex++; state.setupVertex = null;
        if (state.setupIndex === state.setupOrder.length) { state.current = 0; state.phase = 'roll'; log(state, 'L’île est prête. La partie commence !'); }
        else { state.current = state.setupOrder[state.setupIndex]; state.phase = 'setupSettlement'; }
      } else if (state.phase === 'roadBuilding') { state.freeRoads--; finishRoads(state); }
      break;
    }
    case 'BUILD_CITY':
      phase('actions');
      requireRule(legalSites(state, 'city').includes(action.vertex), 'Améliorez une de vos colonies (4 villes maximum).');
      pay(state, p.id, COSTS.city); state.board.vertices[action.vertex].building = 'city';
      log(state, `${p.name} transforme une colonie en ville.`);
      break;
    case 'ROLL': {
      phase('roll');
      state.dice = [1 + Math.floor(random(state) * 6), 1 + Math.floor(random(state) * 6)];
      const total = state.dice[0] + state.dice[1];
      log(state, `${p.name} lance ${state.dice[0]} + ${state.dice[1]} = ${total}.`);
      if (total === 7) {
        state.discards = state.players.filter(pl => resourceCount(pl.resources) > 7).map(pl => ({ player: pl.id, count: Math.floor(resourceCount(pl.resources) / 2) }));
        state.resumePhase = 'actions'; state.phase = state.discards.length ? 'discard' : 'robber';
      } else { produce(state, total); state.phase = 'actions'; }
      break;
    }
    case 'DISCARD': {
      phase('discard');
      const { player, count } = state.discards[0], bag = resourceBag(action.resources);
      requireRule(resourceCount(bag) === count, `Défaussez exactement ${count} cartes.`);
      pay(state, player, bag); state.discards.shift();
      log(state, `${state.players[player].name} défausse ${count} ressources.`);
      if (!state.discards.length) state.phase = 'robber';
      break;
    }
    case 'MOVE_ROBBER': {
      phase('robber');
      requireRule(Number.isInteger(action.hex) && state.board.hexes[action.hex] && action.hex !== state.robber, 'Déplacez le voleur sur un autre terrain.');
      state.robber = action.hex;
      state.victims = [...new Set(state.board.hexes[action.hex].vertices.map(id => state.board.vertices[id].owner))]
        .filter(id => id !== null && id !== p.id && resourceCount(state.players[id].resources) > 0);
      log(state, `${p.name} déplace le voleur.`);
      if (state.victims.length) state.phase = 'victim';
      else { state.phase = state.resumePhase; state.resumePhase = null; }
      break;
    }
    case 'STEAL': {
      phase('victim'); requireRule(state.victims.includes(action.player), 'Choisissez un adversaire voisin du voleur.');
      const victim = state.players[action.player];
      let draw = Math.floor(random(state) * resourceCount(victim.resources));
      for (const r of RESOURCES) {
        draw -= victim.resources[r];
        if (draw < 0) { victim.resources[r]--; p.resources[r]++; break; }
      }
      log(state, `${p.name} vole une ressource à ${victim.name}.`);
      state.victims = []; state.phase = state.resumePhase; state.resumePhase = null;
      break;
    }
    case 'BANK_TRADE': {
      phase('actions');
      requireRule(RESOURCES.includes(action.give) && RESOURCES.includes(action.receive) && action.give !== action.receive, 'Choisissez deux ressources différentes.');
      const rate = tradeRate(state, p.id, action.give);
      requireRule(state.bank[action.receive] > 0, 'La banque n’a plus cette ressource.');
      pay(state, p.id, { [action.give]: rate }); transferFromBank(state, p.id, action.receive, 1);
      log(state, `${p.name} échange ${rate} ressources contre une à la banque.`);
      break;
    }
    case 'OFFER_TRADE': {
      phase('actions');
      requireRule(Number.isInteger(action.target) && state.players[action.target] && action.target !== p.id, 'Choisissez un autre joueur.');
      const give = resourceBag(action.give), receive = resourceBag(action.receive);
      requireRule(resourceCount(give) > 0 && resourceCount(receive) > 0, 'Chaque joueur doit échanger au moins une ressource.');
      requireRule(RESOURCES.every(r => !give[r] || !receive[r]), 'Une même ressource ne peut figurer des deux côtés.');
      requireRule(canAfford(p, give), 'Vous ne possédez pas les ressources proposées.');
      state.offer = { target: action.target, give, receive }; state.phase = 'trade';
      log(state, `${p.name} propose un échange à ${state.players[action.target].name}.`);
      break;
    }
    case 'ACCEPT_TRADE':
    case 'REJECT_TRADE': {
      phase('trade');
      const { target, give, receive } = state.offer, other = state.players[target];
      if (action.type === 'ACCEPT_TRADE') {
        requireRule(canAfford(p, give) && canAfford(other, receive), 'Les ressources nécessaires à cet échange ne sont pas disponibles.');
        for (const r of RESOURCES) { p.resources[r] += receive[r] - give[r]; other.resources[r] += give[r] - receive[r]; }
        log(state, `${other.name} accepte l’échange.`);
      } else log(state, `${other.name} refuse l’échange.`);
      state.offer = null; state.phase = 'actions';
      break;
    }
    case 'BUY_DEVELOPMENT': {
      phase('actions'); requireRule(state.deck.length > 0, 'La pioche est vide.');
      pay(state, p.id, COSTS.development);
      p.development.push({ id: 25 - state.deck.length, type: state.deck.pop(), boughtTurn: state.turn });
      log(state, `${p.name} achète une carte développement.`);
      break;
    }
    case 'PLAY_DEVELOPMENT': {
      phase('roll', 'actions');
      const card = p.development.find(c => c.id === action.cardId);
      requireRule(card && card.type !== 'victory', 'Les points de victoire restent secrets jusqu’à la victoire.');
      requireRule(card.boughtTurn < state.turn, 'Cette carte doit attendre votre prochain tour.');
      requireRule(!state.playedDevelopment, 'Une seule carte développement peut être jouée par tour.');
      const oldPhase = state.phase;
      if (card.type === 'roadBuilding') requireRule(legalSites(state, 'road').length > 0, 'Aucune route ne peut être construite.');
      if (card.type === 'monopoly') requireRule(RESOURCES.includes(action.resource), 'Choisissez une ressource pour le monopole.');
      p.development = p.development.filter(c => c.id !== card.id); state.usedDevelopment.push(card.type); state.playedDevelopment = true;
      log(state, `${p.name} joue ${DEVELOPMENT_NAMES[card.type]}.`);
      if (card.type === 'knight') { p.knights++; state.resumePhase = oldPhase; state.phase = 'robber'; }
      if (card.type === 'roadBuilding') { state.freeRoads = Math.min(2, 15 - pieces(state).roads); state.resumePhase = oldPhase; state.phase = 'roadBuilding'; }
      if (card.type === 'plenty') { state.resumePhase = oldPhase; state.phase = 'plenty'; }
      if (card.type === 'monopoly') {
        for (const other of state.players.filter(pl => pl.id !== p.id)) { p.resources[action.resource] += other.resources[action.resource]; other.resources[action.resource] = 0; }
      }
      break;
    }
    case 'CHOOSE_PLENTY': {
      phase('plenty'); const bag = resourceBag(action.resources);
      requireRule(resourceCount(bag) === Math.min(2, resourceCount(state.bank)), 'Choisissez deux ressources disponibles (ou le reste de la banque).');
      requireRule(RESOURCES.every(r => bag[r] <= state.bank[r]), 'La banque ne possède pas ces ressources.');
      for (const r of RESOURCES) transferFromBank(state, p.id, r, bag[r]);
      state.phase = state.resumePhase; state.resumePhase = null;
      break;
    }
    case 'END_TURN':
      phase('actions');
      // Check the outgoing player before switching: hidden victory cards win on their own turn.
      updateAwards(state);
      if (score(state, p.id) >= 10) { state.winner = p.id; state.phase = 'finished'; break; }
      state.current = (state.current + 1) % state.players.length; state.turn++;
      state.phase = 'roll'; state.dice = null; state.playedDevelopment = false;
      log(state, `À ${state.players[state.current].name} de jouer.`);
      break;
    default: throw new RuleError('Action inconnue.');
  }
  updateAwards(state);
  if (!state.phase.startsWith('setup') && score(state, state.current) >= 10) {
    state.winner = state.current; state.phase = 'finished'; log(state, `${state.players[state.current].name} remporte la partie avec ${score(state, state.current)} points !`);
  }
  return state;
}

export function serializeGame(state) { return JSON.stringify(state); }

export function deserializeGame(text) {
  try {
    requireRule(typeof text === 'string' && text.length < 200000, 'Fichier trop volumineux.');
    const s = JSON.parse(text);
    requireRule(s && s.version === 1 && Array.isArray(s.players) && [3, 4].includes(s.players.length), 'Format de sauvegarde inconnu.');
    const base = createGame({ names: s.players.map(p => p.name), bots: s.players.map(p => p.bot), seed: s.seed });
    const int = (n, max = 1000000) => Number.isInteger(n) && n >= 0 && n <= max;
    const player = n => int(n, s.players.length - 1), owner = n => n === null || player(n);
    const phases = ['setupSettlement', 'setupRoad', 'roll', 'actions', 'discard', 'robber', 'victim', 'roadBuilding', 'plenty', 'trade', 'finished'];
    requireRule(phases.includes(s.phase) && player(s.current) && int(s.turn) && int(s.rng, 4294967295), 'Tour invalide.');
    requireRule(int(s.robber, 18) && s.board && ['hexes', 'vertices', 'edges', 'ports'].every(k => Array.isArray(s.board[k]) && s.board[k].length === base.board[k].length), 'Plateau invalide.');
    const geometry = board => ({ ...board, vertices: board.vertices.map(({ owner, building, ...v }) => v), edges: board.edges.map(({ owner, ...e }) => e) });
    requireRule(JSON.stringify(geometry(s.board)) === JSON.stringify(geometry(base.board)), 'La géométrie du plateau a été altérée.');
    requireRule(s.board.vertices.every(v => owner(v.owner) && (v.owner === null ? v.building === null : ['settlement', 'city'].includes(v.building)) &&
      (v.owner === null || v.neighbors.every(id => s.board.vertices[id].owner === null))) && s.board.edges.every(e => owner(e.owner)), 'Pions invalides.');
    requireRule(s.players.every((p, i) => p.id === i && p.color === COLORS[i] && typeof p.bot === 'boolean' && int(p.knights, 14) &&
      RESOURCES.every(r => int(p.resources?.[r], 19)) && Array.isArray(p.development) && p.development.every(c => int(c.id, 24) && int(c.boughtTurn, s.turn) && c.type in DEVELOPMENT_COUNTS) &&
      pieces(s, i).roads <= 15 && pieces(s, i).settlements <= 5 && pieces(s, i).cities <= 4), 'Joueurs invalides.');
    requireRule(RESOURCES.every(r => int(s.bank?.[r], 19) && s.bank[r] + s.players.reduce((sum, p) => sum + p.resources[r], 0) === 19), 'Stock de ressources incohérent.');
    requireRule(Array.isArray(s.deck) && Array.isArray(s.usedDevelopment), 'Pioche invalide.');
    const cards = [...s.deck, ...s.usedDevelopment, ...s.players.flatMap(p => p.development.map(c => c.type))];
    const held = s.players.flatMap(p => p.development);
    requireRule(cards.length === 25 && Object.entries(DEVELOPMENT_COUNTS).every(([type, n]) => cards.filter(t => t === type).length === n) &&
      !s.usedDevelopment.includes('victory') && new Set(held.map(c => c.id)).size === held.length &&
      s.players.reduce((n, p) => n + p.knights, 0) === s.usedDevelopment.filter(t => t === 'knight').length, 'Cartes incohérentes.');
    requireRule(s.awards && owner(s.awards.road) && owner(s.awards.army) && owner(s.winner) && (s.phase !== 'finished' || (s.winner === s.current && score(s, s.winner) >= 10)), 'Victoire invalide.');
    requireRule(JSON.stringify(s.setupOrder) === JSON.stringify(base.setupOrder) && int(s.setupIndex, base.setupOrder.length) &&
      (s.setupVertex === null || int(s.setupVertex, 53)) && typeof s.playedDevelopment === 'boolean' && int(s.freeRoads, 2) &&
      (s.resumePhase === null || ['roll', 'actions'].includes(s.resumePhase)), 'État de phase invalide.');
    requireRule(s.dice === null || (Array.isArray(s.dice) && s.dice.length === 2 && s.dice.every(n => int(n, 6) && n > 0)), 'Dés invalides.');
    requireRule(Array.isArray(s.discards) && s.discards.every(d => player(d.player) && int(d.count, 47)) && (s.phase !== 'discard' || s.discards.length > 0), 'Défausse invalide.');
    requireRule(Array.isArray(s.victims) && s.victims.every(player) && (s.phase !== 'victim' || s.victims.length > 0), 'Victimes invalides.');
    if (s.phase === 'trade') {
      requireRule(s.offer && player(s.offer.target) && s.offer.target !== s.current, 'Échange invalide.');
      const give = resourceBag(s.offer.give), receive = resourceBag(s.offer.receive);
      requireRule(resourceCount(give) > 0 && resourceCount(receive) > 0 && RESOURCES.every(r => !give[r] || !receive[r]) && canAfford(s.players[s.current], give), 'Offre incohérente.');
    }
    else requireRule(s.offer === null, 'Échange inattendu.');
    if (s.phase.startsWith('setup')) requireRule(s.current === s.setupOrder[s.setupIndex] && (s.phase !== 'setupRoad' || s.board.vertices[s.setupVertex]?.owner === s.current), 'Placement initial invalide.');
    else requireRule(s.setupIndex === s.setupOrder.length && s.setupVertex === null, 'Installation incomplète.');
    if (['robber', 'victim', 'discard', 'roadBuilding', 'plenty'].includes(s.phase)) requireRule(['roll', 'actions'].includes(s.resumePhase), 'Phase de retour invalide.');
    else requireRule(s.resumePhase === null || s.phase === 'finished', 'Phase de retour inattendue.');
    if (s.phase === 'roadBuilding') requireRule(s.freeRoads > 0 && legalSites(s, 'road').length > 0, 'Routes gratuites incohérentes.');
    else requireRule(s.freeRoads === 0 || s.phase === 'finished', 'Routes gratuites inattendues.');
    if (s.phase === 'discard') requireRule(new Set(s.discards.map(d => d.player)).size === s.discards.length && s.discards.every(d => resourceCount(s.players[d.player].resources) > 7 && d.count === Math.floor(resourceCount(s.players[d.player].resources) / 2)), 'Défausse incohérente.');
    else requireRule(s.discards.length === 0 || s.phase === 'finished', 'Défausse inattendue.');
    if (s.phase === 'victim') requireRule(s.victims.every(id => id !== s.current && resourceCount(s.players[id].resources) > 0 && s.board.hexes[s.robber].vertices.some(v => s.board.vertices[v].owner === id)), 'Victime sans voisinage.');
    else requireRule(s.victims.length === 0 || s.phase === 'finished', 'Victime inattendue.');
    requireRule(s.phase === 'finished' || s.winner === null, 'Gagnant prématuré.');
    requireRule(Array.isArray(s.log) && s.log.length <= 100 && s.log.every(l => typeof l === 'string' && l.length <= 300), 'Journal invalide.');
    return s;
  } catch (error) { throw new RuleError(`Sauvegarde invalide : ${error instanceof RuleError ? error.message : 'fichier incomplet ou corrompu.'}`); }
}
