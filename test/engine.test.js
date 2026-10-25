import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, legalSites, score, pieces, canPlaceRoad, longestRoad, tradeRate, resourceCount, decisionPlayer, serializeGame, deserializeGame, COSTS, DEVELOPMENT_COUNTS } from '../src/engine.js';
import { makeBoard, RESOURCES, emptyResources, random } from '../src/board.js';
import { botAction } from '../src/bot.js';
import { boardSVG, escapeHTML } from '../src/board-view.js';

function game(seed = 'test') { return createGame({ seed, names: ['A', 'B', 'C'], bots: [true, true, true] }); }
function ready(seed) {
  let s = game(seed);
  while (s.phase.startsWith('setup')) s = act(s, botAction(s));
  return s;
}
function grant(s, player, resources) {
  for (const [r, n] of Object.entries(resources)) { s.bank[r] -= n - s.players[player].resources[r]; s.players[player].resources[r] = n; }
  return s;
}
function giveCard(s, type, player = s.current, boughtTurn = 0) {
  const id = 25 - s.deck.length;
  s.deck.splice(s.deck.indexOf(type), 1);
  s.players[player].development.push({ id, type, boughtTurn });
  return id;
}
function diceSeed(total) {
  for (let rng = 0; rng < 100000; rng++) {
    const h = { rng };
    if (2 + Math.floor(random(h) * 6) + Math.floor(random(h) * 6) === total) return rng;
  }
  throw new Error('No dice seed');
}
function blankActionState() { const s = game(); s.phase = 'actions'; s.setupIndex = 6; s.turn = 3; return s; }
function own(s, vertex, player, building = 'settlement') { Object.assign(s.board.vertices[vertex], { owner: player, building }); }
function trail(s, length, start = 0) {
  const search = (v, used) => {
    if (used.length === length) return used;
    for (const eid of s.board.vertices[v].edges) {
      if (used.includes(eid)) continue;
      const e = s.board.edges[eid], next = e.a === v ? e.b : e.a;
      const found = search(next, [...used, eid]);
      if (found) return found;
    }
    return null;
  };
  return search(start, []);
}

test('100 deterministic maps have the correct topology, resources, tokens and nonadjacent red numbers', () => {
  for (let i = 0; i < 100; i++) {
    const b = makeBoard(String(i));
    assert.equal(b.hexes.length, 19); assert.equal(b.vertices.length, 54); assert.equal(b.edges.length, 72); assert.equal(b.ports.length, 9);
    assert.deepEqual(b, makeBoard(String(i)));
    assert.deepEqual(Object.fromEntries(['wood', 'wool', 'wheat', 'brick', 'ore', 'desert'].map(r => [r, b.hexes.filter(h => h.terrain === r).length])), { wood: 4, wool: 4, wheat: 4, brick: 3, ore: 3, desert: 1 });
    assert.equal(b.hexes.filter(h => h.number === 6).length, 2); assert.equal(b.hexes.filter(h => h.number === 8).length, 2);
    assert(b.edges.every(e => e.hexes.length !== 2 || !e.hexes.every(id => [6, 8].includes(b.hexes[id].number))));
    assert.equal(new Set(b.ports.flatMap(p => p.vertices)).size, 18);
    assert.equal(b.edges.filter(e => e.hexes.length === 1).length, 30);
    for (const v of b.vertices) assert(v.edges.length >= 2 && v.edges.length <= 3);
  }
});

test('snake setup gives only the second settlement resources, requires its adjacent road, and starts player zero', () => {
  let s = game(); const order = [];
  for (let i = 0; i < 6; i++) {
    order.push(s.current);
    const choice = botAction(s); s = act(s, choice);
    const v = s.board.vertices[choice.vertex];
    assert.equal(resourceCount(s.players[s.current].resources), i < 3 ? 0 : v.hexes.filter(id => s.board.hexes[id].terrain !== 'desert').length);
    assert(legalSites(s, 'road').every(id => [s.board.edges[id].a, s.board.edges[id].b].includes(v.id)));
    const forbidden = s.board.edges.find(e => ![e.a, e.b].includes(v.id));
    assert.throws(() => act(s, { type: 'BUILD_ROAD', edge: forbidden.id }));
    s = act(s, botAction(s));
  }
  assert.deepEqual(order, [0, 1, 2, 2, 1, 0]); assert.equal(s.phase, 'roll'); assert.equal(s.current, 0);
  assert(s.players.every(p => score(s, p.id) === 2));
});

test('actions are immutable, ordered and reject invalid builds without spending resources', () => {
  let s = ready(); const snapshot = serializeGame(s);
  assert.throws(() => act(s, { type: 'END_TURN' }));
  assert.throws(() => act(s, { type: 'BUILD_CITY', vertex: 0 }));
  assert.equal(serializeGame(s), snapshot);
  s.rng = diceSeed(6); const after = act(s, { type: 'ROLL' });
  assert.equal(after.phase, 'actions'); assert.equal(s.phase, 'roll');
  assert.throws(() => act(after, { type: 'ROLL' }));
  const isolated = after.board.edges.find(e => !canPlaceRoad(after, e.id));
  assert.throws(() => act(after, { type: 'BUILD_ROAD', edge: isolated.id }));
});

test('paid roads return costs to bank; enemy settlements block continuation', () => {
  let s = blankActionState(); const e = s.board.edges[0]; own(s, e.a, 0);
  grant(s, 0, { wood: 2, brick: 2 });
  s = act(s, { type: 'BUILD_ROAD', edge: e.id });
  assert.equal(s.players[0].resources.wood, 1); assert.equal(s.bank.wood, 18);
  const extension = s.board.vertices[e.b].edges.find(id => id !== e.id);
  own(s, e.b, 1);
  assert.equal(canPlaceRoad(s, extension), false);
  assert.throws(() => act(s, { type: 'BUILD_ROAD', edge: extension }));
});

test('settlement distance, network connection, piece caps and city replacement', () => {
  let s = blankActionState(), v = s.board.vertices[0];
  s.board.edges[v.edges[0]].owner = 0; grant(s, 0, { ...COSTS.settlement, ore: 3, wheat: 3 });
  s = act(s, { type: 'BUILD_SETTLEMENT', vertex: v.id });
  assert(v.neighbors.every(id => !legalSites(s, 'settlement').includes(id)));
  assert.equal(pieces(s).settlements, 1);
  s = act(s, { type: 'BUILD_CITY', vertex: v.id });
  assert.equal(pieces(s).settlements, 0); assert.equal(pieces(s).cities, 1); assert.equal(score(s, 0), 2);
  s.board.edges.forEach((e, i) => { e.owner = i < 15 ? 0 : null; });
  assert.deepEqual(legalSites(s, 'road'), []);
  s.board.vertices.slice(1, 4).forEach(v => own(s, v.id, 0, 'city'));
  assert.deepEqual(legalSites(s, 'city'), []);
});

test('production pays all players, doubles cities and blocks only the robber hex', () => {
  let s = game(); s.phase = 'roll'; const h = s.board.hexes.find(h => h.number && h.id !== s.robber);
  own(s, h.vertices[0], 0); own(s, h.vertices[2], 1, 'city');
  s.rng = diceSeed(h.number); s = act(s, { type: 'ROLL' });
  assert.equal(s.players[0].resources[h.terrain], 1); assert.equal(s.players[1].resources[h.terrain], 2);
  let blocked = game(); blocked.phase = 'roll'; own(blocked, h.vertices[0], 0); blocked.robber = h.id; blocked.rng = diceSeed(h.number);
  blocked = act(blocked, { type: 'ROLL' }); assert.equal(resourceCount(blocked.players[0].resources), 0);
});

test('bank shortage cancels a resource for multiple recipients, pays remaining stock to a single recipient', () => {
  let s = game(); s.phase = 'roll';
  const h = s.board.hexes.find(h => h.number && h.id !== s.robber);
  own(s, h.vertices[0], 0, 'city'); own(s, h.vertices[2], 1, 'city');
  grant(s, 2, { [h.terrain]: 18 }); s.rng = diceSeed(h.number);
  const after = act(s, { type: 'ROLL' }); assert.equal(after.players[0].resources[h.terrain], 0); assert.equal(after.players[1].resources[h.terrain], 0);
  Object.assign(s.board.vertices[h.vertices[2]], { owner: null, building: null });
  const single = act(s, { type: 'ROLL' }); assert.equal(single.players[0].resources[h.terrain], 1); assert.equal(single.bank[h.terrain], 0);
});

test('seven queues exact half discards before moving and stealing; seven cards need no discard', () => {
  let s = ready(); grant(s, 0, { wood: 9 }); grant(s, 1, { brick: 8 }); grant(s, 2, { wool: 7, wood: 0, wheat: 0, brick: 0, ore: 0 });
  const total = resourceCount(s.players[0].resources); s.rng = diceSeed(7); s = act(s, { type: 'ROLL' });
  assert.equal(s.phase, 'discard'); assert.equal(s.discards[0].count, Math.floor(total / 2));
  assert.throws(() => act(s, { type: 'MOVE_ROBBER', hex: 0 }));
  assert.throws(() => act(s, { type: 'DISCARD', resources: { wood: 1 } }));
  while (s.phase === 'discard') s = act(s, botAction(s));
  assert.equal(s.phase, 'robber'); assert.equal(resourceCount(s.players[2].resources), 7);
  assert.throws(() => act(s, { type: 'MOVE_ROBBER', hex: s.robber }));
  const target = s.board.hexes.find(h => h.id !== s.robber && h.vertices.some(id => s.board.vertices[id].owner === 2));
  s = act(s, { type: 'MOVE_ROBBER', hex: target.id }); assert.equal(s.phase, 'victim');
  const before = resourceCount(s.players[0].resources); s = act(s, { type: 'STEAL', player: 2 });
  assert.equal(resourceCount(s.players[0].resources), before + 1); assert.equal(resourceCount(s.players[2].resources), 6); assert.equal(s.phase, 'actions');
});

test('maritime trades require exact ratios, owned ports and bank availability', () => {
  let s = blankActionState(); grant(s, 0, { wood: 8 });
  s = act(s, { type: 'BANK_TRADE', give: 'wood', receive: 'ore' }); assert.equal(s.players[0].resources.wood, 4); assert.equal(s.players[0].resources.ore, 1);
  assert.throws(() => act(s, { type: 'BANK_TRADE', give: 'wood', receive: 'wood' }));
  const generic = s.board.ports.find(p => p.resource === null); own(s, generic.vertices[0], 0); assert.equal(tradeRate(s, 0, 'wood'), 3);
  const specific = s.board.ports.find(p => p.resource === 'wood'); own(s, specific.vertices[0], 0); assert.equal(tradeRate(s, 0, 'wood'), 2);
  s = act(s, { type: 'BANK_TRADE', give: 'wood', receive: 'wheat' }); assert.equal(s.players[0].resources.wood, 2);
  grant(s, 1, { wool: 19 }); assert.throws(() => act(s, { type: 'BANK_TRADE', give: 'wood', receive: 'wool' }));
});

test('domestic trade needs consent, supports multiple resources, rejects gifts and overlapping resources', () => {
  let s = blankActionState(); grant(s, 0, { wood: 3, wool: 1 }); grant(s, 1, { ore: 2 });
  const offer = { type: 'OFFER_TRADE', target: 1, give: { wood: 2, wool: 1 }, receive: { ore: 2 } };
  s = act(s, offer); assert.equal(decisionPlayer(s), 1); assert.equal(s.players[0].resources.wood, 3);
  assert.throws(() => act(s, { type: 'END_TURN' }));
  const rejected = act(s, { type: 'REJECT_TRADE' }); assert.equal(rejected.players[0].resources.wood, 3);
  s = act(s, { type: 'ACCEPT_TRADE' }); assert.equal(s.players[0].resources.ore, 2); assert.equal(s.players[1].resources.wood, 2);
  assert.throws(() => act(s, { ...offer, give: {} }));
  assert.throws(() => act(s, { ...offer, give: { wood: 1 }, receive: { wood: 1 } }));
  const poor = act(s, { ...offer, give: { wood: 1 }, receive: { ore: 2 } }); assert.throws(() => act(poor, { type: 'ACCEPT_TRADE' }));
});

test('development deck composition, purchase timing, one per turn and knight before dice', () => {
  let s = ready(); s.phase = 'actions'; grant(s, 0, COSTS.development);
  s.deck.splice(s.deck.indexOf('knight'), 1); s.deck.push('knight');
  s = act(s, { type: 'BUY_DEVELOPMENT' }); const card = s.players[0].development[0];
  assert.throws(() => act(s, { type: 'PLAY_DEVELOPMENT', cardId: card.id }));
  s.turn = 3; s.phase = 'roll'; const second = giveCard(s, 'monopoly');
  s = act(s, { type: 'PLAY_DEVELOPMENT', cardId: card.id }); assert.equal(s.phase, 'robber'); assert.equal(s.players[0].knights, 1);
  assert.equal(s.discards.length, 0);
  while (['robber', 'victim'].includes(s.phase)) s = act(s, botAction(s));
  assert.equal(s.phase, 'roll'); assert.throws(() => act(s, { type: 'PLAY_DEVELOPMENT', cardId: second, resource: 'wood' }));
  assert.equal(game().deck.length, 25);
  for (const [type, n] of Object.entries(DEVELOPMENT_COUNTS)) assert.equal(game().deck.filter(c => c === type).length, n);
});

test('road building provides two free connected roads, stops at one remaining piece and resumes pre-roll', () => {
  let s = ready(); s.turn = 3; const card = giveCard(s, 'roadBuilding');
  const before = { ...s.players[0].resources }, roads = pieces(s).roads;
  s = act(s, { type: 'PLAY_DEVELOPMENT', cardId: card });
  s = act(s, botAction(s)); assert.equal(s.phase, 'roadBuilding'); s = act(s, botAction(s));
  assert.equal(s.phase, 'roll'); assert.equal(pieces(s).roads, roads + 2); assert.deepEqual(s.players[0].resources, before);
  let limited = blankActionState(); limited.board.edges.slice(0, 14).forEach(e => { e.owner = 0; }); const id = giveCard(limited, 'roadBuilding');
  limited = act(limited, { type: 'PLAY_DEVELOPMENT', cardId: id }); assert.equal(limited.freeRoads, 1);
  limited = act(limited, { type: 'BUILD_ROAD', edge: legalSites(limited, 'road')[0] }); assert.equal(limited.phase, 'actions'); assert.equal(pieces(limited).roads, 15);
});

test('invention may take two of one resource; monopoly takes all opponents of one type', () => {
  let s = blankActionState(); const id = giveCard(s, 'plenty');
  s = act(s, { type: 'PLAY_DEVELOPMENT', cardId: id });
  assert.throws(() => act(s, { type: 'CHOOSE_PLENTY', resources: { ore: 3 } }));
  s = act(s, { type: 'CHOOSE_PLENTY', resources: { ore: 2 } }); assert.equal(s.players[0].resources.ore, 2); assert.equal(s.phase, 'actions');
  s.playedDevelopment = false; const mono = giveCard(s, 'monopoly'); grant(s, 1, { ore: 3 }); grant(s, 2, { ore: 4 });
  const bank = s.bank.ore; s = act(s, { type: 'PLAY_DEVELOPMENT', cardId: mono, resource: 'ore' });
  assert.equal(s.players[0].resources.ore, 9); assert.equal(s.bank.ore, bank); assert.equal(s.players[1].resources.ore, 0);
});

test('longest road counts cycles, not all forks, and stops at opposing settlements', () => {
  const s = blankActionState(), h = s.board.hexes[9]; h.edges.forEach(id => { s.board.edges[id].owner = 0; });
  assert.equal(longestRoad(s, 0), 6);
  own(s, h.vertices[0], 1); assert.equal(longestRoad(s, 0), 6);
  own(s, h.vertices[3], 1); assert.equal(longestRoad(s, 0), 3);
  const fork = blankActionState(), center = fork.board.vertices.find(v => v.edges.length === 3);
  center.edges.forEach(id => { fork.board.edges[id].owner = 0; }); assert.equal(longestRoad(fork, 0), 2);
});

test('road and army awards keep their holder on ties and require minimums', () => {
  let s = blankActionState(); trail(s, 5).forEach(id => { s.board.edges[id].owner = 0; });
  s = act(s, { type: 'END_TURN' }); assert.equal(s.awards.road, 0);
  s.players[0].knights = 3; s.current = 0; s.phase = 'actions'; s = act(s, { type: 'END_TURN' }); assert.equal(s.awards.army, 0);
  s.players[1].knights = 3; s.phase = 'actions'; s = act(s, { type: 'END_TURN' }); assert.equal(s.awards.army, 0);
  s.players[1].knights = 4; s.phase = 'actions'; s = act(s, { type: 'END_TURN' }); assert.equal(s.awards.army, 1);
  s.board.edges.forEach(e => { e.owner = null; }); s.phase = 'actions'; s = act(s, { type: 'END_TURN' }); assert.equal(s.awards.road, null);
});

test('hidden points win immediately when purchased; off-turn points wait until that player’s own turn', () => {
  let s = blankActionState(); s.board.vertices.slice(0, 4).forEach(v => own(s, v.id, 0, 'city')); own(s, 10, 0);
  grant(s, 0, COSTS.development); s.deck.splice(s.deck.indexOf('victory'), 1); s.deck.push('victory');
  s = act(s, { type: 'BUY_DEVELOPMENT' }); assert.equal(s.phase, 'finished'); assert.equal(s.winner, 0); assert.equal(score(s, 0, false), 9);
  assert.throws(() => act(s, { type: 'END_TURN' }));
  let off = blankActionState(); off.current = 0; off.players[1].knights = 3;
  off.board.vertices.slice(0, 4).forEach(v => own(off, v.id, 1, 'city'));
  grant(off, 0, COSTS.development); off = act(off, { type: 'BUY_DEVELOPMENT' }); assert.equal(off.phase, 'actions');
  off = act(off, { type: 'END_TURN' }); assert.equal(off.phase, 'finished'); assert.equal(off.winner, 1);
});

test('saves round-trip in every encountered phase and reject corrupt data', () => {
  let s = game();
  for (let i = 0; i < 300; i++) {
    assert.deepEqual(deserializeGame(serializeGame(s)), s);
    if (s.phase === 'finished') break;
    s = act(s, botAction(s));
  }
  const corrupt = game(); corrupt.bank.wood = 20; assert.throws(() => deserializeGame(serializeGame(corrupt)));
  const board = game(); board.board.vertices[0].x = 1; assert.throws(() => deserializeGame(serializeGame(board)));
  assert.throws(() => deserializeGame('{}')); assert.throws(() => deserializeGame('not-json'));
  const badPhase = game(); badPhase.phase = 'discard'; assert.throws(() => deserializeGame(serializeGame(badPhase)));
});

test('SVG renders all terrain, ports and accessible legal placements and escapes names', () => {
  const s = game(); const html = boardSVG(s, { kind: 'settlement', legal: legalSites(s, 'settlement'), interactive: true });
  assert.equal((html.match(/class="hex /g) || []).length, 19);
  assert.equal((html.match(/class="port"/g) || []).length, 9);
  assert.equal((html.match(/role="button"/g) || []).length, 54);
  assert.equal(escapeHTML('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('longest-road ties retain the owner, a longer trail transfers it, and a broken leader leaves a tie unclaimed', () => {
  let s = blankActionState();
  for (const [hex, player] of [[0, 0], [2, 1], [18, 2]]) s.board.hexes[hex].edges.forEach(id => { s.board.edges[id].owner = player; });
  s.awards.road = 0; s = act(s, { type: 'END_TURN' }); assert.equal(s.awards.road, 0);
  const extension = s.board.hexes[2].vertices.flatMap(id => s.board.vertices[id].edges).find(id => s.board.edges[id].owner === null);
  s.board.edges[extension].owner = 1; s.phase = 'actions'; s = act(s, { type: 'END_TURN' }); assert.equal(s.awards.road, 1);
  s.board.edges[extension].owner = null;
  for (const index of [0, 3]) s.board.edges[s.board.hexes[2].edges[index]].owner = null;
  s.phase = 'actions'; s = act(s, { type: 'END_TURN' }); assert.equal(s.awards.road, null);
});

test('invention resolves with one remaining resource or an empty bank without stalling', () => {
  for (const remaining of [0, 1]) {
    let s = blankActionState();
    grant(s, 1, emptyResources(19));
    if (remaining) { s.players[1].resources.wood--; s.bank.wood++; }
    const id = giveCard(s, 'plenty'); s = act(s, { type: 'PLAY_DEVELOPMENT', cardId: id });
    s = act(s, { type: 'CHOOSE_PLENTY', resources: { wood: remaining } });
    assert.equal(s.players[0].resources.wood, remaining); assert.equal(s.phase, 'actions');
  }
});

test('road-building ends if no legal extension remains, and settlements respect the five-piece supply', () => {
  let s = blankActionState();
  const e = s.board.edges[0]; own(s, e.a, 0);
  own(s, e.b, 1);
  s.board.vertices[e.a].edges.filter(id => id !== e.id).forEach(id => { s.board.edges[id].owner = 1; });
  const id = giveCard(s, 'roadBuilding'); s = act(s, { type: 'PLAY_DEVELOPMENT', cardId: id });
  s = act(s, { type: 'BUILD_ROAD', edge: e.id }); assert.equal(s.phase, 'actions'); assert.equal(s.freeRoads, 0);
  const capped = game();
  for (let i = 0; i < 5; i++) own(capped, legalSites(capped, 'settlement')[0], 0);
  assert.deepEqual(legalSites(capped, 'settlement'), []);
});

test('bot monopoly choice is independent of opponents’ hidden resource types', () => {
  const s = ready('fair-bots'); s.phase = 'actions'; s.turn = 3;
  giveCard(s, 'monopoly'); grant(s, 1, { wood: 4, ore: 0 });
  const original = botAction(s), different = structuredClone(s);
  grant(different, 1, { wood: 0, ore: 4 });
  assert.deepEqual(botAction(different), original);
});

test('12 full seeded bot games (3 and 4 players) reach a legal winner and conserve all stocks after each action', { timeout: 120000 }, () => {
  for (let seed = 0; seed < 12; seed++) {
    const n = seed % 2 ? 4 : 3;
    let s = createGame({ seed: `simulation-${seed}`, names: ['A', 'B', 'C', 'D'].slice(0, n), bots: Array(n).fill(true) });
    let steps = 0;
    while (s.phase !== 'finished' && steps < 8000) {
      const action = botAction(s);
      try { s = act(s, action); }
      catch (error) { throw new Error(`Seed ${seed}, step ${steps}, ${JSON.stringify(action)}: ${error.message}`); }
      for (const r of RESOURCES) {
        assert.equal(s.bank[r] + s.players.reduce((sum, p) => sum + p.resources[r], 0), 19);
        assert(s.bank[r] >= 0 && s.players.every(p => p.resources[r] >= 0));
      }
      for (const p of s.players) { const stock = pieces(s, p.id); assert(stock.roads <= 15 && stock.settlements <= 5 && stock.cities <= 4); }
      if (steps % 100 === 0) assert.deepEqual(deserializeGame(serializeGame(s)), s);
      steps++;
    }
    assert.equal(s.phase, 'finished', `Seed ${seed} stalled at turn ${s.turn}, phase ${s.phase}`);
    assert(score(s, s.winner) >= 10); assert.equal(s.winner, s.current);
  }
});
