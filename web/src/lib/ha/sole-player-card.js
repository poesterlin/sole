// @ts-nocheck
/**
 * Sole player card for Home Assistant.
 *
 * A dependency-free Lovelace card for a media_player entity. Transport uses
 * Home Assistant's own services, so it works with Music Assistant (or any
 * other player). With a Sole playback key it also mirrors Sole's home page:
 * the "On the dial now" panel, the day's schedules, and continuous radio.
 *
 * Source: web/src/lib/ha/sole-player-card.js
 */

const FONT_LINK_ID = 'sole-player-card-fonts';

if (typeof document !== 'undefined' && !document.getElementById(FONT_LINK_ID)) {
	const link = document.createElement('link');
	link.id = FONT_LINK_ID;
	link.rel = 'stylesheet';
	link.href =
		'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Karla:ital,wght@0,300..800;1,300..800&display=swap';
	document.head.appendChild(link);
}

const ICONS = {
	previous:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14"/><path d="M20 5 10 12l10 7z" fill="currentColor" stroke="none"/></svg>',
	next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14"/><path d="M4 5l10 7-10 7z" fill="currentColor" stroke="none"/></svg>',
	play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/></svg>',
	pause:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor"/></svg>',
	volume:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
	volumeOff:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>',
	speaker:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
	stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
	playOutline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
	heart:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
	ban: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/></svg>',
	sparkle:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
	music:
		'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
};

// Idle, off, and unavailable players often keep the last track's metadata;
// only these states mean a track is actually loaded.
const ACTIVE_STATES = new Set(['playing', 'paused', 'buffering']);

const esc = (value) =>
	String(value ?? '').replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
	);

function formatTime(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	return hours
		? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
		: `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatHour(hour) {
	return `${String(hour).padStart(2, '0')}:00`;
}

function hoursLabel(slot) {
	return slot.startHour === slot.endHour
		? 'All day'
		: `${formatHour(slot.startHour)}–${formatHour(slot.endHour)}`;
}

const STYLES = `
:host { display: block; }
* { box-sizing: border-box; }
button { font-family: inherit; }
.sole {
	--sole-accent: #e8490f;
	--sole-accent-deep: #b23407;
	--sole-cream: #fffdf5;
	--sole-ink: #1d150e;
	--sole-ink-soft: #4c4237;
	--sole-faded: #97887a;
	--sole-gold: #c99b2f;
	container-type: inline-size;
	display: grid;
	gap: 16px;
	font-family: 'Karla', 'Avenir Next', 'Segoe UI', sans-serif;
}

/* Player deck: compact, so the day's schedule leads */
.deck {
	position: relative;
	isolation: isolate;
	border-radius: 14px;
	padding: 18px 20px;
	background: var(--sole-ink);
	color: var(--sole-cream);
	box-shadow: 0 18px 40px -26px rgba(29, 21, 14, 0.9), 0 0 0 1px rgba(29, 21, 14, 0.2);
}
.backdrop { position: absolute; inset: 0; z-index: -1; overflow: hidden; border-radius: inherit; }
.ambient {
	position: absolute;
	inset: -30%;
	z-index: -2;
	background-position: center;
	background-size: cover;
	filter: blur(50px) saturate(1.3);
	opacity: 0.45;
	transform: scale(1.15);
}
.scrim {
	position: absolute;
	inset: 0;
	z-index: -1;
	background:
		radial-gradient(circle at 92% 0%, rgba(232, 73, 15, 0.14), transparent 45%),
		linear-gradient(135deg, rgba(29, 21, 14, 0.3), rgba(29, 21, 14, 0.86) 60%, rgba(29, 21, 14, 0.94));
}
.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.device {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 8px;
	color: rgba(255, 253, 245, 0.5);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.28em;
}
.device svg { flex: 0 0 auto; width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.device span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bars { display: flex; height: 9px; align-items: flex-end; gap: 2px; }
.bars i { width: 2px; border-radius: 2px; background: currentColor; transform-origin: bottom; animation: sole-eq 1.1s ease-in-out infinite; }
.bars i:nth-child(1) { height: 40%; }
.bars i:nth-child(2) { height: 75%; animation-delay: 0.16s; }
.bars i:nth-child(3) { height: 55%; animation-delay: 0.32s; }
.bars i:nth-child(4) { height: 90%; animation-delay: 0.48s; }
@keyframes sole-eq { 0%, 100% { transform: scaleY(0.45); } 50% { transform: scaleY(1); } }

.stage { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 16px; margin-top: 14px; }
.sleeve { position: relative; width: 76px; height: 76px; }
.sleeve .record {
	position: absolute;
	inset: 5%;
	border-radius: 50%;
	transform: translateX(14%);
	background:
		radial-gradient(circle at center, var(--sole-accent) 0 15%, #111 15.5% 17%, transparent 17.5%),
		repeating-radial-gradient(circle at center, #16110c 0 1.5px, #2b231a 1.5px 3px);
	box-shadow: 0 8px 18px -10px rgba(0, 0, 0, 0.9);
}
.sleeve.spinning .record { animation: sole-spin 3s linear infinite; }
@keyframes sole-spin { from { transform: translateX(14%) rotate(0deg); } to { transform: translateX(14%) rotate(360deg); } }
.sleeve img,
.sleeve .blank {
	position: relative;
	z-index: 1;
	display: block;
	width: 100%;
	height: 100%;
	border-radius: 8px;
	object-fit: cover;
	box-shadow: 0 14px 26px -12px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 253, 245, 0.08);
}
.sleeve .blank {
	display: flex;
	align-items: center;
	justify-content: center;
	background: linear-gradient(145deg, var(--sole-accent), var(--sole-gold));
	color: rgba(255, 253, 245, 0.85);
}
.sleeve .blank svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 1.6; }
.meta { min-width: 0; padding-left: 8px; }
.cluster {
	display: inline-flex;
	max-width: 100%;
	align-items: center;
	gap: 6px;
	margin-bottom: 4px;
	color: #ffb08f;
	font-size: 9px;
	font-weight: 800;
	letter-spacing: 0.18em;
	text-decoration: none;
	text-transform: uppercase;
	opacity: 0.85;
}
.cluster span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cluster svg { flex: 0 0 auto; width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.cluster:hover { opacity: 1; text-decoration: underline; text-underline-offset: 3px; }
.title {
	margin: 0;
	display: -webkit-box;
	overflow: hidden;
	font-family: 'Fraunces', Georgia, serif;
	font-size: 20px;
	font-weight: 900;
	line-height: 1.1;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
}
.byline { overflow: hidden; margin: 4px 0 0; color: rgba(255, 253, 245, 0.5); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.byline b { color: rgba(255, 253, 245, 0.88); font-weight: 700; }
.byline i { font-style: italic; }
.clock {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 7px;
	color: rgba(255, 253, 245, 0.5);
	font-size: 11px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}
.clock .bars { color: var(--sole-accent); }
.clock b { color: rgba(255, 253, 245, 0.85); font-weight: 700; }
.toolbar {
	display: grid;
	grid-template-columns: 1fr auto 1fr;
	align-items: center;
	gap: 4px;
	margin-top: 16px;
	border-top: 1px solid rgba(255, 253, 245, 0.08);
	padding-top: 12px;
}
.group { display: flex; align-items: center; gap: 2px; }
.group.end { justify-content: flex-end; }
.transport { gap: 8px; }
.iconbtn {
	display: inline-flex;
	width: 36px;
	height: 36px;
	flex: 0 0 auto;
	align-items: center;
	justify-content: center;
	border: 0;
	border-radius: 999px;
	background: transparent;
	color: rgba(255, 253, 245, 0.62);
	cursor: pointer;
	transition: background 0.15s, color 0.15s, transform 0.15s;
}
.iconbtn:hover { background: rgba(255, 253, 245, 0.08); color: var(--sole-cream); }
.iconbtn:active { transform: scale(0.92); }
.iconbtn:disabled { cursor: not-allowed; opacity: 0.3; }
.iconbtn:disabled:hover { background: transparent; color: rgba(255, 253, 245, 0.62); }
.iconbtn.active { color: var(--sole-accent); }
.iconbtn.liked svg { fill: currentColor; }
.iconbtn.open { background: rgba(255, 253, 245, 0.1); color: var(--sole-cream); }
.iconbtn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.transport .iconbtn { color: rgba(255, 253, 245, 0.85); }
.play {
	width: 46px;
	height: 46px;
	background: var(--sole-accent);
	color: var(--sole-cream) !important;
	box-shadow: 0 10px 22px -10px rgba(232, 73, 15, 0.95);
}
.play:hover { background: var(--sole-accent-deep); transform: scale(1.05); }
.play svg { width: 20px; height: 20px; }
.vol { position: relative; }
.vol-pop {
	position: absolute;
	right: -6px;
	bottom: calc(100% + 10px);
	z-index: 5;
	display: flex;
	width: 230px;
	align-items: center;
	gap: 8px;
	border: 1px solid rgba(255, 253, 245, 0.1);
	border-radius: 12px;
	padding: 8px 12px 8px 6px;
	background: rgba(29, 21, 14, 0.94);
	box-shadow: 0 18px 40px -16px rgba(0, 0, 0, 0.9);
	backdrop-filter: blur(14px);
	animation: sole-pop 0.14s ease-out;
}
.vol-pop::after {
	position: absolute;
	right: 18px;
	bottom: -6px;
	width: 10px;
	height: 10px;
	border-right: 1px solid rgba(255, 253, 245, 0.1);
	border-bottom: 1px solid rgba(255, 253, 245, 0.1);
	background: rgba(29, 21, 14, 0.94);
	content: '';
	transform: rotate(45deg);
}
@keyframes sole-pop { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.vol-pop .iconbtn { width: 32px; height: 32px; }
.vol-pop input[type='range'] {
	flex: 1;
	min-width: 0;
	height: 4px;
	appearance: none;
	border-radius: 999px;
	outline: none;
	background: linear-gradient(to right, var(--sole-accent) var(--level), rgba(255, 253, 245, 0.18) var(--level));
}
.vol-pop input[type='range']::-webkit-slider-thumb {
	width: 14px; height: 14px; appearance: none; border: 0; border-radius: 50%;
	background: var(--sole-cream); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); cursor: pointer;
}
.vol-pop input[type='range']::-moz-range-thumb {
	width: 14px; height: 14px; border: 0; border-radius: 50%; background: var(--sole-cream); cursor: pointer;
}
.volume-value { width: 32px; color: rgba(255, 253, 245, 0.7); text-align: right; font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }

/* Idle deck: a small record with the play label in the middle */
.idle { display: flex; align-items: center; gap: 18px; margin-top: 14px; }
.turntable {
	position: relative;
	display: flex;
	width: 96px;
	height: 96px;
	flex: 0 0 auto;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	background:
		conic-gradient(from 30deg, rgba(255, 255, 255, 0.06), transparent 30%, transparent 65%, rgba(255, 255, 255, 0.05)),
		repeating-radial-gradient(circle at center, #16110c 0 1.5px, #241c14 1.5px 3px);
	box-shadow: 0 18px 30px -18px rgba(0, 0, 0, 0.9), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}
.label {
	display: flex;
	width: 44%;
	aspect-ratio: 1;
	align-items: center;
	justify-content: center;
	border: 0;
	border-radius: 50%;
	background: conic-gradient(from 40deg, var(--sole-accent), var(--sole-gold), var(--sole-accent));
	color: var(--sole-cream);
	cursor: pointer;
	box-shadow: 0 0 0 4px rgba(17, 17, 17, 0.6);
	transition: transform 0.15s, filter 0.15s;
}
.label:hover { transform: scale(1.05); filter: brightness(1.08); }
.label:disabled { cursor: wait; opacity: 0.7; }
.label svg { width: 40%; height: 40%; fill: currentColor; }
.idle-title { margin: 0; font-family: 'Fraunces', Georgia, serif; font-size: 20px; font-weight: 900; }
.idle-note { margin: 4px 0 0; color: rgba(255, 253, 245, 0.5); font-size: 13px; }

/* Dial panel */
.dial {
	border: 1px solid rgba(29, 21, 14, 0.1);
	border-radius: 14px;
	padding: 24px;
	background: var(--sole-cream);
	color: var(--sole-ink);
	box-shadow: 0 18px 40px -28px rgba(29, 21, 14, 0.5);
}
.dial-grid { display: grid; gap: 28px; }
.hero { display: flex; align-items: center; gap: 20px; }
.collage { display: flex; flex: 0 0 auto; align-items: center; padding-left: 6px; }
.collage > * {
	position: relative;
	width: 76px;
	height: 76px;
	flex: 0 0 auto;
	overflow: hidden;
	border-radius: 9px;
	background: var(--sole-ink);
	box-shadow: 0 0 0 4px var(--sole-cream), 0 10px 18px -8px rgba(29, 21, 14, 0.55);
}
.collage > * + * { margin-left: -34px; }
.collage img { display: block; width: 100%; height: 100%; object-fit: cover; }
.collage .disc {
	background:
		radial-gradient(circle at center, var(--sole-accent) 0 16%, #111 16.5% 18%, transparent 18.5%),
		repeating-radial-gradient(circle at center, #16110c 0 2px, #2b231a 2px 4px);
}
.collage .disc.round { border-radius: 50%; }
.eyebrow { margin: 0; color: var(--sole-accent-deep); font-size: 11px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; }
.dial-name {
	margin: 6px 0 0;
	font-family: 'Fraunces', Georgia, serif;
	font-size: clamp(26px, 6cqi, 38px);
	font-weight: 900;
	line-height: 1.08;
	text-wrap: balance;
}
.dial-hours { margin: 4px 0 0; color: var(--sole-ink-soft); font-size: 14px; font-weight: 700; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 22px; }
.pill {
	display: inline-flex;
	min-height: 48px;
	align-items: center;
	justify-content: center;
	gap: 8px;
	border: 1px solid transparent;
	border-radius: 999px;
	padding: 0 26px;
	font-size: 16px;
	font-weight: 700;
	cursor: pointer;
	transition: background 0.15s, opacity 0.15s;
}
.pill svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
.pill.primary { background: var(--sole-ink); color: var(--sole-cream); }
.pill.primary:hover { background: var(--sole-accent-deep); }
.pill.secondary { border-color: rgba(29, 21, 14, 0.15); background: transparent; color: var(--sole-ink); padding: 0 20px; font-size: 14px; }
.pill.secondary:hover { background: rgba(29, 21, 14, 0.05); }
.pill:disabled { cursor: not-allowed; opacity: 0.5; }
.follow { border: 0; background: none; color: var(--sole-accent-deep); font-size: 14px; font-weight: 700; text-decoration: underline; text-underline-offset: 4px; cursor: pointer; }
.day-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.day-label { margin: 0; color: var(--sole-faded); font-size: 11px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; }
.edit { color: var(--sole-accent-deep); font-size: 14px; font-weight: 700; text-decoration: underline; text-underline-offset: 4px; }
.slots { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.slot {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 16px;
	border: 1px solid rgba(29, 21, 14, 0.1);
	border-radius: 10px;
	padding: 13px 16px;
	background: transparent;
	color: var(--sole-ink);
	text-align: left;
	cursor: pointer;
	transition: background 0.15s, border-color 0.15s;
}
.slot:hover { background: rgba(29, 21, 14, 0.05); }
.slot.selected { border-color: var(--sole-ink); background: var(--sole-ink); color: var(--sole-cream); }
.slot-time { width: 96px; flex: 0 0 auto; color: var(--sole-faded); font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
.slot.selected .slot-time { color: rgba(255, 253, 245, 0.6); }
.slot-name { min-width: 0; flex: 1; overflow: hidden; font-size: 16px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.now { border-radius: 999px; padding: 3px 10px; background: var(--sole-accent); color: var(--sole-cream); font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
.note { margin: 12px 0 0; color: var(--sole-ink-soft); font-size: 14px; }
.note.ok { color: #5f6633; font-weight: 700; }
.note.error { color: var(--sole-accent-deep); font-weight: 700; }
.deck .note { color: rgba(255, 253, 245, 0.55); }
.deck .note.ok { color: #dce4bb; }
.deck .note.error { color: #ffb4a0; }

@container (min-width: 600px) {
	.deck { padding: 22px 28px; }
	.stage { grid-template-columns: 92px minmax(0, 1fr); gap: 20px; }
	.sleeve { width: 92px; height: 92px; }
	.title { font-size: 24px; }
	.group { gap: 6px; }
	.dial { padding: 36px 40px; }
	.dial-grid { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 48px; }
	.collage > * { width: 92px; height: 92px; }
	.collage > * + * { margin-left: -38px; }
}
@container (max-width: 360px) {
	.group { gap: 0; }
	.transport { gap: 2px; }
	.iconbtn { width: 32px; height: 32px; }
	.slot-time { width: auto; }
	.hero { align-items: flex-start; flex-direction: column; gap: 14px; }
}
@media (prefers-reduced-motion: reduce) {
	.sleeve.spinning .record, .bars i { animation: none; }
	.bar span { transition: none; }
}
`;

class SolePlayerCard extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._config = null;
		this._hass = null;
		this._signature = '';
		this._draggingVolume = false;
		this._timer = null;
		this._soleTimer = null;
		this._sole = {
			loading: false,
			loaded: false,
			error: '',
			schedules: [],
			activeSchedule: null,
			clusterIds: [],
			names: {},
			covers: {},
			timezone: ''
		};
		this._selectedId = null;
		this._track = { key: '', loading: false, data: null };
		this._trackBusy = null;
		this._volumeOpen = false;
		this._closeVolume = (event) => {
			if (this._volumeOpen && !event.composedPath().includes(this)) {
				this._volumeOpen = false;
				this._render(true);
			}
		};
		this._trackNotice = '';
		this._trackNoticeError = false;
		this._covers = new Map();
		this._soleBusy = null;
		this._soleNotice = '';
		this._soleNoticeError = false;

		this.shadowRoot.addEventListener('click', (event) => this._onClick(event));
		this.shadowRoot.addEventListener('input', (event) => this._onInput(event));
		this.shadowRoot.addEventListener('change', (event) => this._onChange(event));
		this.shadowRoot.addEventListener('pointerdown', (event) => this._onPointerDown(event));
		this.shadowRoot.addEventListener('pointerup', () => this._onPointerUp());
		this.shadowRoot.addEventListener('pointercancel', () => this._onPointerUp());
	}

	static getStubConfig(hass) {
		const players = Object.keys(hass?.states ?? {}).filter((id) => id.startsWith('media_player.'));
		const active = players.find((id) => hass.states[id]?.attributes?.media_title);
		return {
			entity: active ?? players[0] ?? 'media_player.living_room',
			show_volume: true
		};
	}

	setConfig(config) {
		if (!config?.entity) {
			throw new Error('sole-player-card: set "entity" to a media_player entity.');
		}
		if (!String(config.entity).startsWith('media_player.')) {
			throw new Error('sole-player-card: "entity" must be a media_player entity.');
		}
		this._config = {
			show_volume: true,
			show_schedules: true,
			name: '',
			accent: '',
			sole_url: '',
			sole_token: '',
			sole_token_entity: '',
			...config
		};
		this._sole.loaded = false;
		this._signature = '';
		this._render(true);
		if (this._hass) void this._refreshSole();
	}

	set hass(hass) {
		this._hass = hass;
		if (this._soleEnabled() && !this._sole.loaded && !this._sole.loading) {
			void this._refreshSole();
		}
		this._render(false);
	}

	connectedCallback() {
		if (!this._timer) {
			this._timer = setInterval(() => this._render(false), 1000);
		}
		if (!this._soleTimer) {
			this._soleTimer = setInterval(() => void this._refreshSole(), 60_000);
		}
		window.addEventListener('pointerdown', this._closeVolume);
		void this._refreshSole();
	}

	disconnectedCallback() {
		window.removeEventListener('pointerdown', this._closeVolume);
		if (this._timer) clearInterval(this._timer);
		this._timer = null;
		if (this._soleTimer) clearInterval(this._soleTimer);
		this._soleTimer = null;
	}

	getCardSize() {
		return this._soleEnabled() ? 12 : 6;
	}

	_state() {
		return this._hass?.states?.[this._config?.entity];
	}

	_call(service, data = {}) {
		this._hass?.callService?.('media_player', service, {
			entity_id: this._config.entity,
			...data
		});
	}

	_soleBase() {
		return String(this._config?.sole_url || '').replace(/\/+$/, '');
	}

	_soleToken() {
		if (this._config?.sole_token) return this._config.sole_token;
		const entity = this._config?.sole_token_entity;
		return entity ? (this._hass?.states?.[entity]?.state ?? '') : '';
	}

	_soleEnabled() {
		return Boolean(
			this._config?.show_schedules !== false && this._soleBase() && this._soleToken()
		);
	}

	/** Enabled schedules with clusters, in day order, as Sole's home page lists them. */
	_slots() {
		return this._sole.schedules
			.filter((slot) => slot.enabled !== false && slot.clusterIds?.length > 0)
			.toSorted((a, b) => a.startHour - b.startHour || a.id - b.id);
	}

	_selected() {
		const current = this._sole.activeSchedule;
		if (this._selectedId === null) return current;
		return this._slots().find((slot) => slot.id === this._selectedId) ?? current;
	}

	_soleSignature() {
		return JSON.stringify({
			loading: this._sole.loading,
			loaded: this._sole.loaded,
			error: this._sole.error,
			busy: this._soleBusy,
			notice: this._soleNotice,
			noticeError: this._soleNoticeError,
			active: this._sole.activeSchedule?.id ?? null,
			selected: this._selectedId,
			slots: this._slots().map((slot) => [slot.id, slot.name, slot.startHour, slot.endHour, slot.clusterIds]),
			picks: this._sole.clusterIds,
			names: this._sole.names,
			covers: [...this._covers.values()].filter(Boolean).length
		});
	}

	async _refreshSole() {
		if (!this._soleEnabled() || this._sole.loading) return;
		this._sole.loading = true;
		this._sole.error = '';
		this._render(false);
		try {
			const response = await fetch(`${this._soleBase()}/api/play-vibe`, {
				headers: { Authorization: `Bearer ${this._soleToken()}` },
				cache: 'no-store'
			});
			const json = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(json?.error || `Sole returned ${response.status}`);
			}
			this._sole = {
				loading: false,
				loaded: true,
				error: '',
				schedules: Array.isArray(json.schedules) ? json.schedules : [],
				activeSchedule: json.activeSchedule ?? null,
				clusterIds: Array.isArray(json.clusterIds) ? json.clusterIds : [],
				names: json.names ?? {},
				covers: json.covers ?? {},
				timezone: json.scheduleTimezone ?? ''
			};
		} catch (error) {
			this._sole = {
				...this._sole,
				loading: false,
				loaded: true,
				error: error instanceof Error ? error.message : 'Could not reach Sole.'
			};
		}
		this._render(false);
	}

	/**
	 * Sole's cover proxy needs the playback key, which an <img> cannot send, so
	 * covers are fetched once and shown from object URLs.
	 */
	_cover(path) {
		if (!path || !path.startsWith('/imageproxy/')) return '';
		const cached = this._covers.get(path);
		if (cached !== undefined) return cached ?? '';
		this._covers.set(path, null);
		const url = `${this._soleBase()}/api/cover?path=${encodeURIComponent(path)}&size=256`;
		fetch(url, { headers: { Authorization: `Bearer ${this._soleToken()}` } })
			.then((response) => {
				if (!response.ok) throw new Error(`cover ${response.status}`);
				return response.blob();
			})
			.then((blob) => {
				this._covers.set(path, URL.createObjectURL(blob));
				this._render(false);
			})
			.catch(() => {
				// Forget the failure after a minute so a later render retries.
				setTimeout(() => this._covers.delete(path), 60_000);
			});
		return '';
	}

	async _playSole(selection) {
		if (!this._soleEnabled() || this._soleBusy) return;
		this._soleBusy = selection.key;
		this._soleNotice = '';
		this._soleNoticeError = false;
		this._render(false);
		try {
			const response = await fetch(`${this._soleBase()}/api/play-vibe`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this._soleToken()}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ ...selection.body, continuous: true })
			});
			const json = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(json?.error || `Sole returned ${response.status}`);
			}
			this._soleNotice = `Started ${selection.label}`;
		} catch (error) {
			this._soleNotice = error instanceof Error ? error.message : 'Could not start playback.';
			this._soleNoticeError = true;
		} finally {
			this._soleBusy = null;
			this._render(false);
			this._clearNoticeLater();
		}
	}

	/** Confirmations are brief; the panels already show what is playing. */
	_clearNoticeLater() {
		clearTimeout(this._noticeTimer);
		this._noticeTimer = setTimeout(() => {
			this._soleNotice = '';
			this._trackNotice = '';
			this._render(false);
		}, 4000);
	}

	_playSelection(slot) {
		if (slot) {
			void this._playSole({ key: `schedule-${slot.id}`, body: { scheduleId: slot.id }, label: slot.name });
		} else {
			void this._playSole({ key: 'picks', body: {}, label: 'saved mix' });
		}
	}

	_trackKey(attributes) {
		const title = attributes?.media_title || '';
		return title ? `${attributes.media_content_id || ''}|${title}` : '';
	}

	_trackSignature() {
		return JSON.stringify([
			this._track.key,
			this._track.data,
			this._trackBusy,
			this._trackNotice,
			this._trackNoticeError
		]);
	}

	/** Looks the shown track up in Sole whenever the player moves to a new one. */
	_syncTrack(attributes) {
		if (!this._soleEnabled()) {
			if (this._track.key) this._track = { key: '', loading: false, data: null };
			return;
		}
		const key = this._trackKey(attributes);
		if (key === this._track.key) return;
		this._track = { key, loading: false, data: null };
		this._trackNotice = '';
		this._trackNoticeError = false;
		if (!key) return;
		this._track.loading = true;
		const params = new URLSearchParams({ title: attributes.media_title });
		if (attributes.media_content_id) params.set('uri', attributes.media_content_id);
		fetch(`${this._soleBase()}/api/now-playing-track?${params}`, {
			headers: { Authorization: `Bearer ${this._soleToken()}` },
			cache: 'no-store'
		})
			.then((response) => (response.ok ? response.json() : null))
			.then((json) => {
				if (this._track.key !== key) return;
				this._track = { key, loading: false, data: json?.track ?? null };
				this._render(false);
			})
			.catch(() => {
				if (this._track.key !== key) return;
				this._track = { key, loading: false, data: null };
				this._render(false);
			});
	}

	async _trackAction(action) {
		const attributes = this._state()?.attributes ?? {};
		const key = this._track.key;
		const track = this._track.data;
		if (!track || this._trackBusy || !this._soleEnabled()) return;
		this._trackBusy = action;
		this._trackNotice = '';
		this._trackNoticeError = false;
		this._render(false);
		try {
			const response = await fetch(`${this._soleBase()}/api/now-playing-track`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this._soleToken()}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ action, uri: track.uri, title: attributes.media_title })
			});
			const json = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(json?.error || `Sole returned ${response.status}`);
			if (this._track.key === key && json.track) this._track = { ...this._track, data: json.track };
			if (action === 'skip') {
				this._trackNotice = `Skipped “${track.name}” forever`;
				// Marking it skipped alone would leave the track playing out.
				this._call('media_next_track');
			} else if (action === 'like') {
				this._trackNotice = `Liked ${track.name} — spun into future mixes`;
			}
		} catch (error) {
			this._trackNotice = error instanceof Error ? error.message : 'Sole could not update this track.';
			this._trackNoticeError = true;
		} finally {
			this._trackBusy = null;
			this._render(false);
			this._clearNoticeLater();
		}
	}

	_picture(attributes) {
		const raw = attributes?.entity_picture;
		if (!raw) return '';
		try {
			return raw.startsWith('http') ? raw : this._hass?.hassUrl?.(raw) || raw;
		} catch {
			return raw;
		}
	}

	_position(state, attributes) {
		let position = Number(attributes?.media_position);
		if (!Number.isFinite(position) || position < 0) position = 0;
		if (state?.state === 'playing' && attributes?.media_position_updated_at) {
			const updated = Date.parse(attributes.media_position_updated_at);
			if (Number.isFinite(updated)) position += (Date.now() - updated) / 1000;
		}
		const duration = Number(attributes?.media_duration);
		if (Number.isFinite(duration) && duration > 0) position = Math.min(position, duration);
		return position;
	}

	_render(force) {
		if (!this._config || !this._hass) return;
		if (this._draggingVolume && !force) return;

		const state = this._state();
		if (!state) {
			const signature = `missing:${this._config.entity}`;
			if (signature === this._signature && !force) return;
			this._signature = signature;
			this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="sole"><div class="deck"><div class="backdrop"><div class="scrim"></div></div><div class="top"><div class="device">${ICONS.speaker}<span>Sole</span></div></div><p class="title" style="margin-top:18px;font-size:24px">Player not found</p><p class="note">${esc(this._config.entity)} is not available in Home Assistant.</p></div></div>`;
			return;
		}

		const attributes = state.attributes ?? {};
		this._syncTrack(ACTIVE_STATES.has(state.state) ? attributes : {});
		const signature = JSON.stringify([
			state.state,
			attributes.media_title,
			attributes.media_artist,
			attributes.media_album_name,
			attributes.entity_picture,
			attributes.volume_level,
			attributes.is_volume_muted,
			attributes.media_duration,
			this._config.name,
			this._config.accent,
			this._config.show_volume,
			this._volumeOpen,
			this._trackSignature(),
			this._soleSignature()
		]);
		if (!force && signature === this._signature) {
			this._updateProgress();
			return;
		}
		this._signature = signature;
		const accent = this._config.accent ? ` style="--sole-accent:${esc(this._config.accent)}"` : '';
		this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="sole"${accent}>${this._deckMarkup(state, attributes)}${this._dialMarkup()}</div>`;
		this._updateProgress();
	}

	_deckMarkup(state, attributes) {
		const playing = state.state === 'playing';
		const picture = this._picture(attributes);
		const name = this._config.name || attributes.friendly_name || this._config.entity;
		const title = attributes.media_title || '';
		const artist = attributes.media_artist || attributes.media_album_artist || '';
		const album = attributes.media_album_name || '';
		if (!title || !ACTIVE_STATES.has(state.state)) {
			const selected = this._soleEnabled() ? this._selected() : null;
			const canStart = this._soleEnabled() && (selected?.clusterIds?.length || this._sole.clusterIds.length);
			const label = canStart ? `Play ${selected?.name ?? 'my picks'}` : 'Play';
			return `
				<div class="deck">
					<div class="backdrop"><div class="scrim"></div></div>
					<div class="top"><div class="device">${ICONS.speaker}<span>${esc(name)}</span></div></div>
					<div class="idle">
						<div class="turntable">
							<button type="button" class="label" data-action="${canStart ? 'play-selected' : 'play_pause'}" aria-label="${esc(label)}" title="${esc(label)}" ${this._soleBusy ? 'disabled' : ''}>${ICONS.play}</button>
						</div>
						<div>
							<p class="idle-title">${this._soleBusy ? 'Starting…' : 'Nothing playing'}</p>
						</div>
					</div>
				</div>`;
		}

		const showVolume = this._config.show_volume && typeof attributes.volume_level === 'number';
		const volume = typeof attributes.volume_level === 'number' ? attributes.volume_level : 0;
		const muted = attributes.is_volume_muted === true;
		const track = this._track.data;
		const clusterLink =
			track?.clusterId !== null && track?.clusterId !== undefined
				? `<a class="cluster" href="${esc(this._soleBase())}/vibe?tab=browse&amp;cluster=${track.clusterId}" target="_blank" rel="noreferrer">${ICONS.sparkle}<span>${esc(track.clusterName ?? `Cluster ${track.clusterId}`)}</span></a>`
				: '';
		// Liking and perma skip need Sole to know the track; until it answers,
		// or for tracks outside the library, the buttons stay visible but off.
		const trackReady = Boolean(track) && !this._trackBusy;
		const trackTitle = this._soleEnabled()
			? this._track.loading
				? 'Looking this track up in Sole…'
				: track
					? ''
					: 'This track is not in Sole’s library.'
			: 'Add a Sole playback key to like and skip tracks.';
		const busyTrack = this._trackBusy;
		const tip = (label) => esc(trackTitle || label);
		const like = track?.liked
			? `<button type="button" class="iconbtn active liked" data-action="unlike" aria-pressed="true" aria-label="Remove like" title="${tip('Liked — tap to remove')}" ${trackReady ? '' : 'disabled'}>${ICONS.heart}</button>`
			: `<button type="button" class="iconbtn" data-action="like" aria-pressed="false" aria-label="Like" title="${tip('Like')}" ${trackReady ? '' : 'disabled'}>${ICONS.heart}</button>`;
		const skip = `<button type="button" class="iconbtn" data-action="perma-skip" aria-label="Perma skip" title="${tip(busyTrack === 'skip' ? 'Skipping…' : 'Perma skip — never play again')}" ${trackReady ? '' : 'disabled'}>${ICONS.ban}</button>`;
		const percent = Math.round(volume * 100);

		return `
			<div class="deck">
				<div class="backdrop">
					${picture ? `<div class="ambient" style="background-image:url('${esc(picture)}')"></div>` : ''}
					<div class="scrim"></div>
				</div>
				<div class="top">
					<div class="device">${ICONS.speaker}<span>${esc(name)}</span></div>
					<span class="clock">
						${playing ? '<span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ''}
						<span><b data-role="elapsed">--:--</b> / <span data-role="duration">--:--</span></span>
					</span>
				</div>
				<div class="stage">
					<div class="sleeve ${playing ? 'spinning' : ''}">
						<div class="record"></div>
						${picture ? `<img src="${esc(picture)}" alt="">` : `<div class="blank">${ICONS.music}</div>`}
					</div>
					<div class="meta">
						${clusterLink}
						<p class="title">${esc(title)}</p>
						${artist || album ? `<p class="byline">${artist ? `<b>${esc(artist)}</b>` : ''}${artist && album ? ' · ' : ''}${album ? `<i>${esc(album)}</i>` : ''}</p>` : ''}
					</div>
				</div>
				<div class="toolbar">
					<div class="group">${like}${skip}</div>
					<div class="group transport">
						<button type="button" class="iconbtn" data-action="previous" aria-label="Previous track" title="Previous">${ICONS.previous}</button>
						<button type="button" class="iconbtn play" data-action="play_pause" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? ICONS.pause : ICONS.play}</button>
						<button type="button" class="iconbtn" data-action="next" aria-label="Next track" title="Next">${ICONS.next}</button>
					</div>
					<div class="group end">
						<button type="button" class="iconbtn" data-action="stop" aria-label="Stop" title="Stop">${ICONS.stop}</button>
						${
							showVolume
								? `<div class="vol">
									<button type="button" class="iconbtn ${this._volumeOpen ? 'open' : ''}" data-action="toggle-volume" aria-expanded="${this._volumeOpen}" aria-label="Volume ${percent}%" title="Volume ${percent}%">${muted || volume === 0 ? ICONS.volumeOff : ICONS.volume}</button>
									${
										this._volumeOpen
											? `<div class="vol-pop" role="dialog" aria-label="Volume">
												<button type="button" class="iconbtn" data-action="mute" aria-label="${muted ? 'Unmute' : 'Mute'}">${muted ? ICONS.volumeOff : ICONS.volume}</button>
												<input type="range" min="0" max="1" step="0.01" value="${volume}" style="--level:${percent}%" data-action="volume" aria-label="Volume">
												<span class="volume-value" data-role="volume-value">${percent}%</span>
											</div>`
											: ''
									}
								</div>`
								: ''
						}
					</div>
				</div>
				${this._trackNotice ? `<p class="note ${this._trackNoticeError ? 'error' : 'ok'}">${esc(this._trackNotice)}</p>` : ''}
			</div>`;
	}

	_dialMarkup() {
		if (this._config?.show_schedules === false || !this._soleBase()) return '';
		if (!this._soleToken()) {
			return `<div class="dial"><p class="eyebrow">Sole</p><p class="note error">Add a Sole playback key to show schedules.</p></div>`;
		}
		if (!this._sole.loaded) {
			return `<div class="dial" aria-busy="true"><p class="eyebrow">On the dial now</p><p class="note">Reading schedules…</p></div>`;
		}

		const slots = this._slots();
		const current = this._sole.activeSchedule;
		const selected = this._selected();
		const picks = this._sole.clusterIds;
		const ids = selected?.clusterIds ?? picks;
		const busy = Boolean(this._soleBusy);
		const base = esc(this._soleBase());
		const eyebrow = selected ? (selected.id === current?.id ? 'On the dial now' : 'Up later') : 'Saved mix';
		const subtitle = selected ? hoursLabel(selected) : 'Nothing scheduled now';
		const clusterNames = ids.map((id) => this._sole.names?.[id] ?? `Cluster ${id}`).join(', ');

		const collage = ids.length
			? ids
					.slice(0, 3)
					.map((id, index) => {
						const image = this._cover(this._sole.covers?.[id]);
						const tilt = `transform:rotate(${index % 2 === 0 ? -5 : 4}deg);z-index:${3 - index}`;
						return image
							? `<div style="${tilt}"><img src="${esc(image)}" alt=""></div>`
							: `<div class="disc" style="${tilt}"></div>`;
					})
					.join('')
			: '<div class="disc round"></div>';

		const startingSelected = busy && this._soleBusy !== 'picks';
		const startingPicks = this._soleBusy === 'picks';

		return `
			<div class="dial" aria-busy="${busy}">
				<div class="dial-grid">
					<div>
						<div class="hero">
							<div class="collage" title="${esc(clusterNames)}">${collage}</div>
							<div style="min-width:0">
								<p class="eyebrow">${eyebrow}</p>
								<p class="dial-name">${esc(selected?.name ?? 'Saved mix')}</p>
								<p class="dial-hours">${esc(subtitle)}</p>
							</div>
						</div>
						<div class="actions">
							<button type="button" class="pill primary" data-action="play-selected" ${busy || !ids.length ? 'disabled' : ''}>
								${ICONS.playOutline}${startingSelected ? 'Starting…' : esc(`Play ${selected?.name ?? 'saved mix'}`)}
							</button>
							${selected ? `<button type="button" class="pill secondary" data-action="play-picks" title="Play the clusters saved on Sole’s Vibe page" ${busy || !picks.length ? 'disabled' : ''}>${startingPicks ? 'Starting…' : 'Play saved mix'}</button>` : ''}
							${this._selectedId !== null ? `<button type="button" class="follow" data-action="follow" ${busy ? 'disabled' : ''}>Back to now</button>` : ''}
						</div>
						${this._soleNotice ? `<p class="note ${this._soleNoticeError ? 'error' : 'ok'}">${esc(this._soleNotice)}</p>` : ''}
						${this._sole.error ? `<p class="note error">${esc(this._sole.error)}</p>` : ''}
					</div>
					<div style="min-width:0">
						<div class="day-head">
							<p class="day-label"${this._sole.timezone ? ` title="Times in ${esc(this._sole.timezone)}"` : ''}>Your day</p>
							<a class="edit" href="${base}/vibe?tab=schedule" target="_blank" rel="noreferrer">Edit</a>
						</div>
						${
							slots.length
								? `<ul class="slots">${slots
										.map((slot) => {
											const isSelected = selected?.id === slot.id;
											return `<li><button type="button" class="slot ${isSelected ? 'selected' : ''}" data-action="select-slot" data-id="${slot.id}" aria-pressed="${isSelected}">
												<span class="slot-time">${esc(hoursLabel(slot))}</span>
												<span class="slot-name">${esc(slot.name)}</span>
												${slot.id === current?.id ? '<span class="now">Now</span>' : ''}
											</button></li>`;
										})
										.join('')}</ul>`
								: `<p class="note">No enabled schedules. <a class="edit" href="${base}/vibe?tab=schedule" target="_blank" rel="noreferrer">Create a schedule</a></p>`
						}
					</div>
				</div>
			</div>`;
	}

	_updateProgress() {
		const state = this._state();
		if (!state) return;
		const attributes = state.attributes ?? {};
		const duration = Number(attributes.media_duration);
		const position = this._position(state, attributes);
		const hasDuration = Number.isFinite(duration) && duration > 0;
		const elapsed = this.shadowRoot.querySelector('[data-role="elapsed"]');
		if (elapsed) elapsed.textContent = formatTime(position);
		const total = this.shadowRoot.querySelector('[data-role="duration"]');
		if (total) total.textContent = hasDuration ? formatTime(duration) : '--:--';
	}

	_onClick(event) {
		const target = event.target?.closest?.('[data-action]');
		if (this._volumeOpen && !event.target?.closest?.('.vol')) {
			this._volumeOpen = false;
			this._render(true);
		}
		if (!target) return;
		const action = target.dataset.action;
		if (action === 'play_pause') {
			this._call('media_play_pause');
		} else if (action === 'previous') {
			this._call('media_previous_track');
		} else if (action === 'next') {
			this._call('media_next_track');
		} else if (action === 'toggle-volume') {
			this._volumeOpen = !this._volumeOpen;
			this._render(true);
		} else if (action === 'like' || action === 'unlike') {
			void this._trackAction(action);
		} else if (action === 'perma-skip') {
			void this._trackAction('skip');
		} else if (action === 'stop') {
			this._call('media_stop');
		} else if (action === 'mute') {
			this._call('volume_mute', {
				is_volume_muted: this._state()?.attributes?.is_volume_muted !== true
			});
		} else if (action === 'select-slot') {
			const id = Number(target.dataset.id);
			if (Number.isFinite(id)) this._selectedId = id;
			this._render(false);
		} else if (action === 'follow') {
			this._selectedId = null;
			this._render(false);
		} else if (action === 'play-selected') {
			this._playSelection(this._selected());
		} else if (action === 'play-picks') {
			this._playSelection(null);
		}
	}

	_onInput(event) {
		if (event.target?.dataset?.action !== 'volume') return;
		const percent = Math.round(Number(event.target.value) * 100);
		event.target.style.setProperty('--level', `${percent}%`);
		const value = this.shadowRoot.querySelector('[data-role="volume-value"]');
		if (value) value.textContent = `${percent}%`;
	}

	_onChange(event) {
		if (event.target?.dataset?.action !== 'volume') return;
		this._call('volume_set', { volume_level: Number(event.target.value) });
		this._draggingVolume = false;
	}

	_onPointerDown(event) {
		if (event.target?.dataset?.action === 'volume') this._draggingVolume = true;
	}

	_onPointerUp() {
		if (!this._draggingVolume) return;
		this._draggingVolume = false;
		this._render(true);
	}
}

if (!customElements.get('sole-player-card')) {
	customElements.define('sole-player-card', SolePlayerCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === 'sole-player-card')) {
	window.customCards.push({
		type: 'sole-player-card',
		name: 'Sole Player',
		description: 'Sole’s listening room: now playing, transport, and your day’s schedules.',
		preview: true
	});
}
