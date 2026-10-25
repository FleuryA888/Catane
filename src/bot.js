import { RESOURCES, emptyResources, vertexValue } from './board.js';
import { COSTS, canAfford, resourceCount, legalSites, decisionPlayer, distanceFree, pieces, tradeRate } from './engine.js';

function routePlan(state) {
  const p = state.current, { vertices, edges } = state.board;
  const distance = vertices.map(() => Infinity), first = vertices.map(() => null);
  const queue = [];
  for (const v of vertices) {
    if (v.owner === p || (v.owner === null && v.edges.some(id => edges[id].owner === p))) {
      distance[v.id] = 0; queue.push(v.id);
    }
  }
  while (queue.length) {
    queue.sort((a, b) => distance[a] - distance[b]);
    const id = queue.shift(), v = vertices[id];
    if (v.owner !== null && v.owner !== p) continue;
    for (const eid of v.edges) {
      const e = edges[eid];
      if (e.owner !== null && e.owner !== p) continue;
      const to = e.a === id ? e.b : e.a, d = distance[id] + (e.owner === p ? 0 : 1);
      if (d < distance[to]) { distance[to] = d; first[to] = first[id] ?? (e.owner === null ? eid : null); queue.push(to); }
    }
  }
  const targets = vertices.filter(v => distanceFree(state, v.id) && distance[v.id] > 0 && distance[v.id] < Infinity && first[v.id] !== null);
  targets.sort((a, b) => vertexValue(state.board, b.id) / (distance[b.id] + 0.5) - vertexValue(state.board, a.id) / (distance[a.id] + 0.5));
  return targets.length ? first[targets[0].id] : legalSites(state, 'road')[0];
}

function neededResources(player, cost) {
  return Object.entries(cost).flatMap(([r, n]) => Array(Math.max(0, n - player.resources[r])).fill(r));
}

export function botAction(state) {
  const player = state.players[decisionPlayer(state)], current = state.players[state.current];
  const sites = kind => legalSites(state, kind);
  const bestVertex = ids => [...ids].sort((a, b) => vertexValue(state.board, b) - vertexValue(state.board, a))[0];
  switch (state.phase) {
    case 'setupSettlement': {
      const ownedTerrains = new Set(state.board.vertices.filter(v => v.owner === player.id).flatMap(v => v.hexes.map(id => state.board.hexes[id].terrain)));
      const value = id => vertexValue(state.board, id) + state.board.vertices[id].hexes.reduce((sum, h) => sum + (!ownedTerrains.has(state.board.hexes[h].terrain) ? 1.2 : 0), 0);
      return { type: 'BUILD_SETTLEMENT', vertex: sites('settlement').sort((a, b) => value(b) - value(a))[0] };
    }
    case 'setupRoad': {
      const value = id => {
        const e = state.board.edges[id], far = e.a === state.setupVertex ? e.b : e.a;
        return state.board.vertices[far].neighbors.reduce((best, v) => Math.max(best, distanceFree(state, v) ? vertexValue(state.board, v) : 0), 0);
      };
      return { type: 'BUILD_ROAD', edge: sites('road').sort((a, b) => value(b) - value(a))[0] };
    }
    case 'roll': return { type: 'ROLL' };
    case 'discard': {
      const bag = emptyResources(), rest = { ...player.resources };
      for (let i = 0; i < state.discards[0].count; i++) {
        const r = [...RESOURCES].sort((a, b) => rest[b] - rest[a])[0]; bag[r]++; rest[r]--;
      }
      return { type: 'DISCARD', resources: bag };
    }
    case 'robber': {
      const value = h => h.vertices.reduce((sum, id) => {
        const v = state.board.vertices[id];
        return sum + (v.owner === null ? 0 : v.owner === current.id ? -3 : 1) * (v.building === 'city' ? 2 : 1) * (h.number ? 6 - Math.abs(7 - h.number) : 0);
      }, 0);
      return { type: 'MOVE_ROBBER', hex: state.board.hexes.filter(h => h.id !== state.robber).sort((a, b) => value(b) - value(a))[0].id };
    }
    case 'victim': return { type: 'STEAL', player: [...state.victims].sort((a, b) => resourceCount(state.players[b].resources) - resourceCount(state.players[a].resources))[0] };
    case 'roadBuilding': return { type: 'BUILD_ROAD', edge: routePlan(state) };
    case 'plenty': {
      const desired = neededResources(current, COSTS.city).concat(neededResources(current, COSTS.settlement), RESOURCES, RESOURCES);
      const bag = emptyResources();
      while (resourceCount(bag) < Math.min(2, resourceCount(state.bank))) {
        const r = desired.find(r => state.bank[r] > bag[r]);
        if (r) { bag[r]++; desired.splice(desired.indexOf(r), 1); }
        else break;
      }
      return { type: 'CHOOSE_PLENTY', resources: bag };
    }
    case 'trade': {
      const { give, receive } = state.offer;
      const incoming = resourceCount(give), outgoing = resourceCount(receive);
      return { type: canAfford(player, receive) && incoming >= outgoing ? 'ACCEPT_TRADE' : 'REJECT_TRADE' };
    }
    case 'actions': {
      if (!state.playedDevelopment) {
        const card = current.development.find(c => c.type !== 'victory' && c.boughtTurn < state.turn && (c.type !== 'roadBuilding' || sites('road').length));
        if (card) {
          // Choose from public production potential; never inspect opponents' hidden hands.
          const potential = r => state.board.vertices.filter(v => v.owner !== null && v.owner !== current.id).reduce((n, v) =>
            n + v.hexes.filter(id => state.board.hexes[id].terrain === r).reduce((sum, id) => sum + (6 - Math.abs(7 - state.board.hexes[id].number)) * (v.building === 'city' ? 2 : 1), 0), 0);
          const resource = [...RESOURCES].sort((a, b) => potential(b) - potential(a))[0];
          return { type: 'PLAY_DEVELOPMENT', cardId: card.id, resource };
        }
      }
      const targets = [];
      if (sites('city').length) targets.push({ cost: COSTS.city, action: { type: 'BUILD_CITY', vertex: bestVertex(sites('city')) } });
      if (sites('settlement').length) targets.unshift({ cost: COSTS.settlement, action: { type: 'BUILD_SETTLEMENT', vertex: bestVertex(sites('settlement')) } });
      if (pieces(state).settlements < 5 && sites('road').length) targets.push({ cost: COSTS.road, action: { type: 'BUILD_ROAD', edge: routePlan(state) } });
      if (state.deck.length) targets.push({ cost: COSTS.development, action: { type: 'BUY_DEVELOPMENT' } });
      const affordable = targets.find(t => canAfford(current, t.cost));
      if (affordable) return affordable.action;
      for (const target of targets) {
        const needed = neededResources(current, target.cost);
        const receive = needed.find(r => state.bank[r] > 0);
        if (!receive) continue;
        const give = RESOURCES.find(r => r !== receive && current.resources[r] - (target.cost[r] || 0) >= tradeRate(state, current.id, r));
        if (give) return { type: 'BANK_TRADE', give, receive };
      }
      return { type: 'END_TURN' };
    }
    default: return null;
  }
}
