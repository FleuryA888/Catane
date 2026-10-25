import { RESOURCES, RESOURCE_NAMES, RESOURCE_ICONS, emptyResources } from './board.js';
import { createGame, act, legalSites, score, pieces, resourceCount, COSTS, canAfford, tradeRate, longestRoad, DEVELOPMENT_NAMES, decisionPlayer, serializeGame, deserializeGame } from './engine.js';
import { botAction } from './bot.js';
import { boardSVG, escapeHTML as esc } from './board-view.js';

const app = document.querySelector('#app');
const STORAGE_KEY = 'catane.game.v1';
let state = null, selection = null, modal = null, revealed = null, botTimer = null, toastTimer = null;
let selectionBag = emptyResources(), setupCount = 3, setupMode = 'solo', errorMessage = '', storageWarning = '';
let setupNames = ['Capitaine', 'Éloïse', 'Gabriel', 'Jade'], setupSeed = '';
let savedText = null;
try { savedText = localStorage.getItem(STORAGE_KEY); if (savedText) state = deserializeGame(savedText); }
catch { storageWarning = 'La sauvegarde locale ne peut pas être lue. Vous pouvez importer une autre sauvegarde ou commencer une partie.'; }
if (!state) { state = createGame({ seed: 'l-ile-vous-attend' }); modal = 'new'; }

const icon = (name, cls = '') => {
  const paths = {
    hex: '<path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m7 11 5-4 5 4v7h-4v-5h-2v5H7Z"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01"/>',
    road: '<path d="m6 3-3 18m15-18 3 18M12 4v3m0 4v3m0 4v3"/>',
    settlement: '<path d="m2 11 10-9 10 9M5 9v12h14V9m-9 12v-8h4v8"/>',
    city: '<path d="M3 21V10l5-4 5 4v11m0-6V5l4-3 4 3v16ZM7 14h2m8-6h1m-1 4h1"/>',
    card: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="m12 6 1.4 3 3.6.5-2.5 2.5.6 3.5L12 14l-3.1 1.5.6-3.5L7 9.5l3.6-.5Z"/>',
    trade: '<path d="M3 7h17l-4-4m5 14H4l4 4M3 7l4 4m14 6-4-4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    trophy: '<path d="M7 3h10v7a5 5 0 0 1-10 0ZM7 5H3v4a4 4 0 0 0 4 4m10-8h4v4a4 4 0 0 1-4 4M12 15v6m-5 0h10"/>',
    anchor: '<circle cx="12" cy="4" r="2"/><path d="M12 6v15M7 10h10M3 13a9 9 0 0 0 18 0M3 13v5m18-5v5"/>'
  };
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.hex}</svg>`;
};
const resourceChip = (r, n = null) => `<span class="resource-chip ${r}" title="${RESOURCE_NAMES[r]}"><span aria-hidden="true">${RESOURCE_ICONS[r]}</span> ${n === null ? RESOURCE_NAMES[r] : n}</span>`;
const bagText = bag => RESOURCES.filter(r => bag[r]).map(r => `${bag[r]} ${RESOURCE_NAMES[r].toLowerCase()}`).join(', ');
const costHTML = cost => `<span class="cost">${Object.entries(cost).map(([r, n]) => resourceChip(r, n)).join('')}</span>`;
const button = (action, label, { cls = '', disabled = false, data = '', title = '' } = {}) => `<button type="button" class="${cls}" data-action="${action}" ${disabled ? 'disabled' : ''} ${data} ${title ? `title="${esc(title)}"` : ''}>${label}</button>`;
const currentHuman = () => !state.players[decisionPlayer(state)].bot;
const handVisible = () => revealed === decisionPlayer(state) && currentHuman() && modal !== 'new';

function persist() {
  try { localStorage.setItem(STORAGE_KEY, serializeGame(state)); }
  catch { storageWarning = 'Sauvegarde automatique indisponible. Exportez votre partie pour la conserver.'; }
}
function notify(message, isError = false) {
  const toast = document.querySelector('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message; toast.className = `toast visible ${isError ? 'error' : ''}`;
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 4500);
}
function send(action) {
  try {
    const before = decisionPlayer(state), oldPhase = state.phase;
    state = act(state, action);
    if (decisionPlayer(state) !== before || action.type === 'END_TURN' || (oldPhase === 'setupRoad' && state.phase === 'roll')) revealed = null;
    if (state.players.filter(p => !p.bot).length === 1 && currentHuman()) revealed = decisionPlayer(state);
    selection = null; selectionBag = emptyResources(); errorMessage = '';
    if (state.phase === 'finished') modal = 'winner';
    persist(); render();
  } catch (error) { notify(error.message, true); }
}

function stage() {
  const p = state.players[state.current];
  const instructions = {
    setupSettlement: ['Prenez place sur l’île', `Placez ${state.setupIndex < state.players.length ? 'votre première' : 'votre seconde'} colonie sur une intersection libre.`],
    setupRoad: ['Reliez votre colonie', 'Placez une route à côté de la colonie que vous venez de fonder.'],
    roll: ['Un nouveau tour commence', 'Lancez les dés pour récolter. Vous pouvez d’abord jouer une carte développement.'],
    actions: ['À vous de bâtir', 'Construisez, négociez, ou préparez votre prochain tour.'],
    discard: ['Le voleur approche', `${state.players[decisionPlayer(state)].name} doit rendre ${state.discards[0]?.count} ressources à la banque.`],
    robber: ['Déplacez le voleur', 'Choisissez un autre terrain. Sa production sera bloquée.'],
    victim: ['Choisissez votre cible', 'Volez une carte au hasard à un adversaire voisin.'],
    roadBuilding: ['Deux routes vers l’avenir', `Placez encore ${state.freeRoads} route${state.freeRoads > 1 ? 's' : ''} gratuitement.`],
    plenty: ['L’abondance vous sourit', 'Prenez deux ressources de votre choix à la banque.'],
    trade: ['Une offre sur la table', `${p.name} vous propose un échange. À vous de décider.`],
    finished: ['Une île, une victoire', `${state.players[state.winner]?.name} a atteint ${state.winner !== null ? score(state, state.winner) : 10} points de victoire.`]
  };
  return instructions[state.phase];
}

function playerCards() {
  return state.players.map(p => {
    const active = p.id === state.current, stock = pieces(state, p.id), road = longestRoad(state, p.id);
    const visible = handVisible() && decisionPlayer(state) === p.id;
    return `<article class="player-card ${active ? 'active' : ''}" style="--player:${p.color}" aria-label="${esc(p.name)}, ${score(state, p.id, visible || state.phase === 'finished')} points${visible ? '' : ' publics'}">
      <span class="player-avatar">${esc(p.name.slice(0, 1).toUpperCase())}${p.bot ? '<span class="bot-dot" title="Adversaire automatique">✦</span>' : ''}</span>
      <div class="player-info"><strong>${esc(p.name)}</strong><span>${active ? '<i class="live-dot"></i> À son tour' : p.bot ? 'Automate' : 'Explorateur'}</span></div>
      <div class="player-score"><strong>${score(state, p.id, visible || state.phase === 'finished')}</strong><span> / 10 PV</span></div>
      <div class="player-stats"><span title="Cartes ressources">▤ ${resourceCount(p.resources)}</span><span title="Cartes développement">${icon('card')} ${p.development.length}</span><span title="Colonies et villes">${icon('settlement')} ${stock.settlements + stock.cities}</span><span title="Longueur de route maximale">${icon('road')} ${road}</span><span title="Chevaliers joués">⚑ ${p.knights}</span></div>
      ${state.awards.road === p.id || state.awards.army === p.id ? `<div class="player-awards">${state.awards.road === p.id ? '⌁ Route +2 PV' : ''} ${state.awards.army === p.id ? '⚑ Armée +2 PV' : ''}</div>` : ''}
    </article>`;
  }).join('');
}

function bankPanel() {
  return `<details class="bank-panel"><summary>${icon('anchor')} Banque & ports <span>${state.deck.length} cartes dév.</span></summary><div class="bank-stocks">${RESOURCES.map(r => `<div>${resourceChip(r)}<strong>${state.bank[r]}</strong></div>`).join('')}</div><p>Les ports s’activent avec une colonie ou une ville sur l’une de leurs deux intersections.</p></details>`;
}

function diceHTML() {
  const dots = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  return `<div class="dice-area">${(state.dice || [null, null]).map((d, i) => `<div class="die ${d ? 'rolled' : ''} ${i ? 'second' : ''}" aria-label="Dé ${d || 'non lancé'}">${d ? Array.from({ length: 9 }, (_, index) => `<i class="${dots[d].includes(index + 1) ? 'dot' : ''}"></i>`).join('') : '<span>?</span>'}</div>`).join('')}<span class="dice-total">${state.dice ? `<strong>${state.dice[0] + state.dice[1]}</strong><small>${state.dice[0] + state.dice[1] === 7 ? 'Le voleur !' : 'Production'}</small>` : '<small>À vous<br>de lancer</small>'}</span></div>`;
}

function resourcePicker(maxBag, count, action, label) {
  return `<div class="resource-picker">${RESOURCES.map(r => `<div class="picker-row">${resourceChip(r)}<div class="stepper">${button('minus', '−', { data: `data-resource="${r}"`, disabled: selectionBag[r] === 0, title: `Retirer ${RESOURCE_NAMES[r]}` })}<output aria-label="${RESOURCE_NAMES[r]} sélectionné">${selectionBag[r]}</output>${button('plus', '+', { data: `data-resource="${r}"`, disabled: selectionBag[r] >= maxBag[r] || resourceCount(selectionBag) >= count, title: `Ajouter ${RESOURCE_NAMES[r]}` })}</div><span class="available">/ ${maxBag[r]}</span></div>`).join('')}</div><p class="picker-count">${resourceCount(selectionBag)} / ${count} ressources sélectionnées</p>${button(action, label, { cls: 'primary full', disabled: resourceCount(selectionBag) !== count })}`;
}

function controls() {
  const [title, description] = stage(), p = state.players[state.current], hidden = !handVisible();
  let body = '';
  if (state.phase === 'finished') body = button('winner', `${icon('trophy')} Voir les résultats`, { cls: 'primary full' });
  else if (p.bot && state.phase !== 'discard' && state.phase !== 'trade' || state.players[decisionPlayer(state)].bot) body = '<div class="thinking"><span></span><span></span><span></span> Réflexion en cours…</div>';
  else if (hidden) body = button('reveal', `${icon('eye')} Prendre la main`, { cls: 'primary full' });
  else if (state.phase === 'roll') body = button('roll', `${icon('dice')} Lancer les dés`, { cls: 'primary full' });
  else if (state.phase === 'actions') body = `<div class="build-actions">${[
    ['road', 'Route'], ['settlement', 'Colonie'], ['city', 'Ville'], ['development', 'Développement']
  ].map(([kind, label]) => {
    const possible = canAfford(p, COSTS[kind]) && (kind === 'development' ? state.deck.length > 0 : legalSites(state, kind).length > 0);
    return button(kind === 'development' ? 'buy-dev' : 'select-build', `<span class="build-label">${icon(kind === 'development' ? 'card' : kind)}<strong>${label}</strong>${selection === kind ? '<span class="selected-mark">✓</span>' : ''}</span>${costHTML(COSTS[kind])}`, { cls: `build-action ${selection === kind ? 'selected' : ''}`, disabled: !possible, data: `data-kind="${kind}"`, title: possible ? `Construire : ${label}` : 'Ressources, emplacement ou pions insuffisants' });
  }).join('')}</div><div class="trade-actions">${button('bank', `${icon('anchor')} Banque`, { cls: 'secondary' })}${button('trade', `${icon('trade')} Joueurs`, { cls: 'secondary' })}</div>${button('end-turn', `Terminer mon tour ${icon('arrow')}`, { cls: 'end-turn full' })}`;
  else if (state.phase === 'discard') body = resourcePicker(state.players[decisionPlayer(state)].resources, state.discards[0].count, 'discard', 'Rendre les ressources');
  else if (state.phase === 'plenty') body = resourcePicker(state.bank, Math.min(2, resourceCount(state.bank)), 'plenty', 'Prendre les ressources');
  else if (state.phase === 'victim') body = `<div class="victim-list">${state.victims.map(id => button('steal', `<span style="--player:${state.players[id].color}" class="color-dot"></span>${esc(state.players[id].name)}<span>${resourceCount(state.players[id].resources)} cartes</span>`, { cls: 'secondary', data: `data-id="${id}"` })).join('')}</div>`;
  else if (state.phase === 'trade') {
    const offer = state.offer;
    body = `<div class="trade-offer"><small>VOUS RECEVEZ</small><p>${esc(bagText(offer.give))}</p><small>VOUS DONNEZ</small><p>${esc(bagText(offer.receive))}</p></div>${button('accept', 'Accepter l’échange', { cls: 'primary full', disabled: !canAfford(state.players[offer.target], offer.receive) })}${button('reject', 'Refuser', { cls: 'secondary full' })}`;
  } else body = '<div class="board-instruction"><span class="pulsing-dot"></span> Choisissez un emplacement lumineux sur le plateau.</div>';
  return `<section class="turn-panel"><div class="eyebrow">${state.phase.startsWith('setup') ? `INSTALLATION · ${state.setupIndex + 1}/${state.setupOrder.length}` : `TOUR ${Math.floor(state.turn / state.players.length) + 1}`}</div><h2>${title}</h2><p class="turn-description" id="turn-description">${esc(description)}</p>${!state.phase.startsWith('setup') ? diceHTML() : '<div class="setup-progress">' + state.setupOrder.map((id, i) => `<span style="background:${state.players[id].color}" class="${i <= state.setupIndex ? 'complete' : ''}"></span>`).join('') + '</div>'}${body}</section>${bankPanel()}`;
}

function handHTML() {
  const id = decisionPlayer(state), p = state.players[id], visible = handVisible();
  if (!visible) return `<section class="hand-panel concealed"><div>${icon('card')}<h2>Les ambitions se gardent secrètes.</h2><p>${p.bot ? 'Les automates préparent leurs prochains coups.' : `La main de ${esc(p.name)} est masquée.`}</p></div>${!p.bot && state.phase !== 'finished' ? button('reveal', `${icon('eye')} Voir ma main`, { cls: 'secondary' }) : ''}</section>`;
  const stock = pieces(state, id);
  return `<section class="hand-panel"><div class="section-heading"><h2>Votre réserve <span>${esc(p.name)}</span></h2>${button('hide', `${icon('eye')} Masquer`, { cls: 'text-button' })}</div><div class="resource-hand">${RESOURCES.map(r => `<div class="resource-card ${r} ${!p.resources[r] ? 'empty' : ''}"><span class="resource-art" aria-hidden="true">${RESOURCE_ICONS[r]}</span><strong>${p.resources[r]}</strong><span>${RESOURCE_NAMES[r]}</span><small>Port ${tradeRate(state, id, r)}:1</small></div>`).join('')}</div>
    <div class="hand-footer"><span>${icon('road')} ${15 - stock.roads} routes</span><span>${icon('settlement')} ${5 - stock.settlements} colonies</span><span>${icon('city')} ${4 - stock.cities} villes restantes</span><strong>${score(state, id)} PV au total</strong></div>
    <div class="development-hand"><h3>${icon('card')} Cartes développement <span>${p.development.length}</span></h3>${p.development.length ? `<div class="development-cards">${p.development.map(c => {
      const playable = id === state.current && ['roll', 'actions'].includes(state.phase) && !state.playedDevelopment && c.boughtTurn < state.turn && c.type !== 'victory' && (c.type !== 'roadBuilding' || legalSites(state, 'road').length > 0);
      return button('play-dev', `<span>${c.type === 'victory' ? icon('trophy') : c.type === 'knight' ? '⚑' : icon('card')}</span><strong>${DEVELOPMENT_NAMES[c.type]}</strong><small>${c.type === 'victory' ? '+1 PV secret' : c.boughtTurn === state.turn ? 'Disponible au prochain tour' : state.playedDevelopment ? 'Une carte déjà jouée ce tour' : 'Jouer la carte'}</small>`, { cls: `development-card ${c.type}`, data: `data-id="${c.id}"`, disabled: !playable });
    }).join('')}</div>` : '<p class="muted">Une carte peut changer le cours de la partie.</p>'}</div></section>`;
}

function header() {
  return `<header class="app-header"><a class="brand" href="#" aria-label="Catane accueil">${icon('hex')}<span>CATANE<small>L’ÎLE VOUS ATTEND</small></span></a><nav aria-label="Menu principal">${button('rules', `${icon('help')} <span>Comment jouer</span>`, { cls: 'nav-button' })}${button('export', icon('download'), { cls: 'icon-button', title: 'Exporter la sauvegarde' })}${button('import', icon('upload'), { cls: 'icon-button', title: 'Importer une sauvegarde' })}${button('new', 'Nouvelle partie', { cls: 'secondary small' })}</nav></header>`;
}

function render() {
  const focus = document.activeElement;
  const focusAction = focus?.dataset?.action, focusResource = focus?.dataset?.resource;
  const id = decisionPlayer(state), show = handVisible(), p = state.players[id];
  let kind = selection;
  if (state.phase === 'setupSettlement') kind = 'settlement';
  if (state.phase === 'setupRoad' || state.phase === 'roadBuilding') kind = 'road';
  if (state.phase === 'robber') kind = 'robber';
  const canInteract = show && !modal && state.phase !== 'finished';
  app.innerHTML = `${header()}<main class="app-main"><div class="table-heading"><div><span class="eyebrow">UNE ÎLE À PARTAGER</span><h1>De petites colonies.<br class="mobile-break"> De grandes ambitions.</h1></div><div class="game-status"><span class="save-dot"></span> Sauvegarde automatique <span class="seed" title="Graine du plateau">Île ${esc(state.seed)}</span></div></div>
    ${storageWarning ? `<p class="storage-warning">${esc(storageWarning)}</p>` : ''}
    <div class="game-layout"><div class="island-column"><section class="players" style="--players:${state.players.length}" aria-label="Joueurs">${playerCards()}</section><section class="board-panel"><div class="board-top"><span>${icon('hex')} L’archipel</span><span>${state.phase.startsWith('setup') ? 'L’aventure commence' : `${state.players.length} explorateurs · Objectif 10 PV`}</span></div>
      <div class="board-stage">${boardSVG(state, { kind, legal: legalSites(state, kind), interactive: canInteract })}${!show && currentHuman() && !modal && state.phase !== 'finished' ? `<div class="privacy-curtain"><span class="curtain-symbol">${icon('hex')}</span><span class="eyebrow">À VOUS DE JOUER</span><h2>${esc(p.name)}</h2><p>${state.phase === 'trade' ? 'Un échange vous est proposé.' : state.phase === 'discard' ? 'Le voleur vous demande quelques ressources.' : 'Prenez la main pour poursuivre l’aventure.'}</p>${button('reveal', `${icon('eye')} Je suis ${esc(p.name)}`, { cls: 'primary' })}<small>Les autres joueurs peuvent détourner le regard.</small></div>` : ''}</div>
      <div class="board-bottom"><div class="terrain-legend">${RESOURCES.map(r => `<span><i class="${r}"></i>${RESOURCE_NAMES[r]}</span>`).join('')}<span><i class="desert"></i>Désert</span></div>${selection ? button('cancel-build', 'Annuler la construction', { cls: 'text-button' }) : '<span class="board-tip">6 et 8 · les terres les plus généreuses</span>'}</div></section>${handHTML()}</div>
    <aside class="sidebar" aria-label="Actions et journal">${controls()}<section class="journal"><div class="section-heading"><h2>La vie sur l’île</h2><span class="live-dot"></span></div><ol aria-live="polite">${state.log.slice(-6).reverse().map((l, i) => `<li class="${i ? '' : 'latest'}"><span class="log-dot"></span>${esc(l)}</li>`).join('')}</ol></section></aside></div>
    <footer class="app-footer"><span>Fait pour les bâtisseurs, les négociateurs et les amis.</span><span>Adaptation indépendante · Jeu de base · 3–4 joueurs</span></footer></main>
    <div id="toast" class="toast" role="status" aria-live="polite"></div><input type="file" id="import-file" accept="application/json,.json" hidden />${modal ? renderModal() : ''}`;
  if (focusAction && !modal) {
    const candidates = [...app.querySelectorAll('[data-action]')];
    candidates.find(el => el.dataset.action === focusAction && el.dataset.resource === focusResource && !el.disabled)?.focus({ preventScroll: true });
  }
  if (modal) requestAnimationFrame(() => app.querySelector('.modal [autofocus], .modal button, .modal input')?.focus({ preventScroll: true }));
  scheduleBot();
}

function modalShell(title, body, cls = '') {
  return `<div class="modal-backdrop"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-top"><span class="eyebrow">CATANE · L’ÎLE VOUS ATTEND</span>${button('close-modal', icon('close'), { cls: 'icon-button', title: 'Fermer la fenêtre' })}</div>${body}</section></div>`;
}

function renderModal() {
  if (modal === 'new') return modalShell('Nouvelle partie', `<div class="new-game-layout"><div class="new-game-art"><span class="eyebrow">BÂTIR. ÉCHANGER. EXPLORER.</span>${boardSVG(createGame({ seed: 'l-ile-vous-attend' }))}<div class="art-caption">Chaque île raconte<br>une nouvelle histoire.</div></div><div class="new-game-form"><span class="eyebrow">BIENVENUE SUR CATANE</span><h2>L’île vous<br>attend<span>.</span></h2><p>Quelques ressources, un peu d’audace.<br>Et tout un monde à construire.</p><form id="new-game-form"><div class="segmented" aria-label="Mode de jeu">${button('mode', 'En solo', { cls: setupMode === 'solo' ? 'active' : '', data: 'data-mode="solo"' })}${button('mode', 'Entre amis', { cls: setupMode === 'friends' ? 'active' : '', data: 'data-mode="friends"' })}</div><div class="form-row"><label>Explorateurs<select id="player-count" name="count"><option value="3" ${setupCount === 3 ? 'selected' : ''}>3 joueurs</option><option value="4" ${setupCount === 4 ? 'selected' : ''}>4 joueurs</option></select></label><label>Graine de l’île <span>(facultatif)</span><input name="seed" maxlength="100" placeholder="Une nouvelle île au hasard" value="${esc(setupSeed)}" /></label></div><div class="player-names">${Array.from({ length: setupCount }, (_, i) => `<label><span class="name-dot player-${i}"></span>${i === 0 ? 'Vous' : setupMode === 'solo' ? `Automate ${i}` : `Joueur ${i + 1}`}<input name="name-${i}" aria-label="Nom du joueur ${i + 1}" maxlength="24" required value="${esc(setupNames[i])}" /></label>`).join('')}</div><p class="mode-description">${setupMode === 'solo' ? 'Affrontez des automates sur cet écran. Leur stratégie reste simple.' : 'Partagez cet écran : les mains sont masquées à chaque passage.'}</p>${errorMessage ? `<p class="form-error">${esc(errorMessage)}</p>` : ''}<button class="primary full start-button" type="submit">Embarquer pour l’île ${icon('arrow')}</button>${savedText ? '<p class="muted">Commencer remplacera la sauvegarde locale actuelle.</p>' : ''}</form></div></div>`, 'new-game-modal');
  if (modal === 'rules') return modalShell('Comment jouer', `<div class="rules-content"><span class="eyebrow">LE GUIDE DES EXPLORATEURS</span><h2>Une île. Dix points.<br>Votre histoire.</h2><p>Gagnez dès que vous possédez <strong>10 points pendant votre propre tour</strong>. Une colonie vaut 1 point, une ville 2. Les points des cartes restent secrets.</p><div class="rules-grid"><article><span>01</span><h3>Installez-vous</h3><p>Chacun pose une colonie et sa route, puis une seconde en ordre inverse. Gardez une intersection libre entre deux bâtiments. La seconde colonie fournit vos premières ressources.</p></article><article><span>02</span><h3>Récoltez</h3><p>Lancez deux dés : chaque terrain du total obtenu produit 1 ressource par colonie voisine et 2 par ville, pour tous les joueurs. Le voleur bloque son terrain.</p></article><article><span>03</span><h3>Bâtissez & échangez</h3><p>Après le lancer, construisez et échangez librement. La banque échange à 4:1, les ports généraux à 3:1 et spécialisés à 2:1. Les échanges entre joueurs nécessitent leur accord.</p></article><article><span>04</span><h3>Méfiez-vous du sept</h3><p>Au-delà de 7 ressources, rendez la moitié de votre main, arrondie vers le bas. Le joueur actif déplace ensuite le voleur et vole une carte au hasard à un voisin.</p></article></div><h3>Le prix de vos ambitions</h3><div class="rules-costs">${Object.entries(COSTS).map(([k, cost]) => `<div><strong>${({ road: 'Route', settlement: 'Colonie', city: 'Ville', development: 'Développement' })[k]}</strong>${costHTML(cost)}</div>`).join('')}</div><h3>Les cartes qui changent tout</h3><p>La pioche contient 14 Chevaliers (déplacer le voleur), 2 Constructions de routes (2 routes gratuites), 2 Inventions (2 ressources au choix), 2 Monopoles (tous les adversaires cèdent une ressource choisie) et 5 Points de victoire.</p><p>Jouez <strong>une carte développement par tour</strong>, avant ou après le lancer, à partir du tour suivant son achat. Les points de victoire comptent immédiatement, même achetés ce tour.</p><h3>Deux belles façons de prendre l’avantage</h3><p><strong>Route la plus longue :</strong> 2 points pour une chaîne continue d’au moins 5 routes. Une colonie adverse la coupe. <strong>Armée la plus puissante :</strong> 2 points dès 3 Chevaliers joués. En cas d’égalité, le détenteur conserve sa distinction.</p><p>Vous disposez de 15 routes, 5 colonies et 4 villes. Une ville remplace une colonie, qui retourne dans votre réserve. La banque a 19 cartes de chaque ressource. En cas de pénurie lors d’une récolte, cette ressource n’est pas distribuée ; si un seul joueur en bénéficie, il reçoit le stock restant.</p><p class="muted">Version locale du jeu de base. Les extensions et le jeu en réseau ne sont pas inclus. Les mains restent accessibles dans le fichier de sauvegarde. Consultez <a href="https://www.catan.com/understand-catan/game-rules" target="_blank" rel="noreferrer">les règles officielles</a>.</p></div>`, 'rules-modal');
  if (modal === 'bank') return modalShell('Commerce maritime', `<h2>Le port des possibles.</h2><p>Échangez vos ressources au meilleur tarif disponible.</p><form id="bank-form"><div class="trade-columns"><label>Vous donnez<select name="give">${RESOURCES.map(r => `<option value="${r}" ${state.players[state.current].resources[r] < tradeRate(state, state.current, r) ? 'disabled' : ''}>${tradeRate(state, state.current, r)} ${RESOURCE_NAMES[r]} (vous : ${state.players[state.current].resources[r]})</option>`).join('')}</select></label><span>${icon('arrow')}</span><label>Vous recevez<select name="receive">${RESOURCES.map(r => `<option value="${r}" ${!state.bank[r] ? 'disabled' : ''}>1 ${RESOURCE_NAMES[r]} (banque : ${state.bank[r]})</option>`).join('')}</select></label></div><p class="form-error" id="trade-error"></p><button class="primary full" type="submit">Confirmer l’échange</button></form>`);
  if (modal === 'trade') return modalShell('Commerce entre joueurs', `<h2>Tout se négocie.</h2><p>Proposez un échange au joueur de votre choix. Il pourra l’accepter ou le refuser.</p><form id="trade-form"><label>Votre partenaire<select name="target">${state.players.filter(p => p.id !== state.current).map(p => `<option value="${p.id}">${esc(p.name)}${p.bot ? ' · Automate' : ''}</option>`).join('')}</select></label><div class="trade-table"><span>Ressource</span><span>Vous donnez</span><span>Vous recevez</span>${RESOURCES.map(r => `${resourceChip(r)}<input type="number" name="give-${r}" aria-label="Donner ${RESOURCE_NAMES[r]}" min="0" max="${state.players[state.current].resources[r]}" value="0"/><input type="number" name="receive-${r}" aria-label="Recevoir ${RESOURCE_NAMES[r]}" min="0" max="19" value="0"/>`).join('')}</div><p class="form-error" id="trade-error"></p><button type="submit" class="primary full">Proposer l’échange ${icon('arrow')}</button></form>`);
  if (modal?.startsWith('monopoly:')) return modalShell('Monopole', `<h2>À vous le monopole.</h2><p>Tous les adversaires vous cèdent les cartes de la ressource choisie.</p><div class="monopoly-options">${RESOURCES.map(r => button('monopoly', resourceChip(r), { cls: 'secondary', data: `data-resource="${r}" data-id="${modal.split(':')[1]}"` })).join('')}</div>`);
  if (modal === 'winner') {
    const ranking = [...state.players].sort((a, b) => score(state, b.id) - score(state, a.id));
    return modalShell('Victoire', `<div class="winner-content"><div class="winner-trophy">${icon('trophy')}</div><span class="eyebrow">L’ÎLE SE SOUVIENDRA DE VOUS</span><h2>${esc(state.players[state.winner].name)}<br>remporte la partie.</h2><p>${score(state, state.winner)} points · ${Math.floor(state.turn / state.players.length) + 1} manches d’aventure</p><div class="ranking">${ranking.map((p, i) => `<div><span>${i + 1}</span><span class="color-dot" style="--player:${p.color}"></span><strong>${esc(p.name)}</strong><span>${score(state, p.id)} PV</span></div>`).join('')}</div>${button('new', `Une nouvelle aventure ${icon('arrow')}`, { cls: 'primary full' })}</div>`);
  }
  return '';
}

function scheduleBot() {
  clearTimeout(botTimer);
  if (modal || state.phase === 'finished' || !state.players[decisionPlayer(state)].bot) return;
  botTimer = setTimeout(() => {
    try { const action = botAction(state); if (action) send(action); }
    catch (error) { notify(`L’automate a rencontré une erreur : ${error.message}. Exportez la partie pour conserver votre progression.`, true); }
  }, 650);
}

app.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  const action = el.dataset.action, id = Number(el.dataset.id), r = el.dataset.resource;
  switch (action) {
    case 'reveal': revealed = decisionPlayer(state); render(); break;
    case 'hide': revealed = null; render(); break;
    case 'roll': send({ type: 'ROLL' }); break;
    case 'end-turn': send({ type: 'END_TURN' }); break;
    case 'buy-dev': send({ type: 'BUY_DEVELOPMENT' }); break;
    case 'select-build': selection = selection === el.dataset.kind ? null : el.dataset.kind; render(); break;
    case 'cancel-build': selection = null; render(); break;
    case 'vertex': send({ type: selection === 'city' ? 'BUILD_CITY' : 'BUILD_SETTLEMENT', vertex: id }); break;
    case 'edge': send({ type: 'BUILD_ROAD', edge: id }); break;
    case 'hex': send({ type: 'MOVE_ROBBER', hex: id }); break;
    case 'steal': send({ type: 'STEAL', player: id }); break;
    case 'plus': selectionBag[r]++; render(); break;
    case 'minus': selectionBag[r]--; render(); break;
    case 'discard': send({ type: 'DISCARD', resources: selectionBag }); break;
    case 'plenty': send({ type: 'CHOOSE_PLENTY', resources: selectionBag }); break;
    case 'accept': send({ type: 'ACCEPT_TRADE' }); break;
    case 'reject': send({ type: 'REJECT_TRADE' }); break;
    case 'bank': case 'trade': if (handVisible() && state.phase === 'actions') { modal = action; render(); } break;
    case 'new': modal = 'new'; errorMessage = ''; render(); break;
    case 'rules': modal = 'rules'; render(); break;
    case 'winner': modal = 'winner'; render(); break;
    case 'close-modal': modal = null; render(); break;
    case 'mode': setupMode = el.dataset.mode; render(); break;
    case 'play-dev': {
      const card = state.players[state.current].development.find(c => c.id === id);
      if (card.type === 'monopoly') { modal = `monopoly:${id}`; render(); }
      else send({ type: 'PLAY_DEVELOPMENT', cardId: id });
      break;
    }
    case 'monopoly': modal = null; send({ type: 'PLAY_DEVELOPMENT', cardId: id, resource: r }); break;
    case 'export': {
      const url = URL.createObjectURL(new Blob([serializeGame(state)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `catane-${state.turn + 1}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Votre sauvegarde a été exportée.'); break;
    }
    case 'import': document.querySelector('#import-file').click(); break;
  }
});

app.addEventListener('input', event => {
  if (event.target.form?.id !== 'new-game-form') return;
  if (event.target.name === 'seed') setupSeed = event.target.value;
  if (event.target.name.startsWith('name-')) setupNames[Number(event.target.name.slice(5))] = event.target.value;
});

app.addEventListener('change', async event => {
  if (event.target.id === 'player-count') { setupCount = Number(event.target.value); render(); }
  if (event.target.id === 'import-file') {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 200000) throw new Error('Ce fichier est trop volumineux.');
      const loaded = deserializeGame(await file.text());
      state = loaded; revealed = null; selection = null; selectionBag = emptyResources(); modal = loaded.phase === 'finished' ? 'winner' : null;
      storageWarning = ''; persist(); render(); notify('La traversée reprend : partie importée.');
    } catch (error) { notify(error.message, true); }
  }
});

app.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target, data = new FormData(form);
  if (form.id === 'new-game-form') {
    try {
      const names = Array.from({ length: setupCount }, (_, i) => data.get(`name-${i}`));
      state = createGame({ names, bots: names.map((_, i) => setupMode === 'solo' && i > 0), seed: data.get('seed')?.trim() || crypto.randomUUID().slice(0, 8) });
      modal = null; revealed = 0; selection = null; selectionBag = emptyResources(); storageWarning = ''; savedText = serializeGame(state); persist(); render();
    } catch (error) { errorMessage = error.message; render(); }
  }
  if (form.id === 'bank-form' || form.id === 'trade-form') {
    const action = form.id === 'bank-form' ? { type: 'BANK_TRADE', give: data.get('give'), receive: data.get('receive') } : {
      type: 'OFFER_TRADE', target: Number(data.get('target')),
      give: Object.fromEntries(RESOURCES.map(r => [r, Number(data.get(`give-${r}`))])),
      receive: Object.fromEntries(RESOURCES.map(r => [r, Number(data.get(`receive-${r}`))]))
    };
    try { act(state, action); modal = null; send(action); }
    catch (error) { document.querySelector('#trade-error').textContent = error.message; }
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (modal) modal = null; else selection = null; render(); }
  if (['Enter', ' '].includes(event.key) && event.target.matches('.board-target')) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  if (event.key === 'Tab' && modal) {
    const elements = [...document.querySelectorAll('.modal button:not(:disabled), .modal input, .modal select, .modal a[href]')].filter(el => el.getClientRects().length);
    if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
  }
});
window.addEventListener('pagehide', () => clearTimeout(botTimer));
render();
