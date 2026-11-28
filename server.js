// Сервер мультиплеера «Монета смерти», версия 3.3.
// Комнаты до 30 игроков, видимость по расстоянию, чат, общий урон по боссам и мобам, вызов Бога.
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ROOM_MAX = 30;      // игроков в одной комнате
const NEAR = 300;         // игроки дальше этого расстояния не передаются
const MAX_KEYS = 600;     // боссов и мобов с общим здоровьем в одной комнате

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Монета смерти: сервер работает. Игроков: ' + wss.clients.size + ', комнат: ' + rooms.length);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const players = new Map(); // ws -> { id, s, room, tokens, tt, chatAt }
const rooms = [];          // { n, set:Set<ws>, dealt:{}, seen:{}, dirty:bool }

const num = (v) => (typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e6 ? v : 0);
const big = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 1e15 ? v : 0);
const str = (v, n, d) => (typeof v === 'string' ? v.slice(0, n) : d);

function joinRoom(ws) {
  let r = rooms.find((x) => x.set.size < ROOM_MAX);
  if (!r) { r = { n: rooms.length + 1, set: new Set(), dealt: {}, seen: {}, changed: {}, godAt: 0 }; rooms.push(r); }
  r.set.add(ws);
  return r;
}
function sendRoom(r, msg, except) {
  r.set.forEach((c) => { if (c !== except && c.readyState === 1) c.send(msg); });
}

wss.on('connection', (ws) => {
  const id = crypto.randomBytes(4).toString('hex');
  const room = joinRoom(ws);
  const p = { id, s: null, room, tokens: 40, tt: Date.now(), chatAt: 0 };
  players.set(ws, p);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.send(JSON.stringify({ type: 'welcome', id, room: room.n, count: room.set.size }));
  ws.send(JSON.stringify({ type: 'bosses', b: room.dealt }));

  ws.on('message', (raw) => {
    const now = Date.now();
    p.tokens = Math.min(40, p.tokens + (now - p.tt) / 25); p.tt = now;   // до 40 сообщений в секунду
    if (p.tokens < 1) return;
    p.tokens -= 1;
    let d;
    try { d = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;

    if (d.type === 'state') {
      p.s = {
        name: str(d.name, 16, 'Игрок'),
        x: num(d.x), y: num(d.y), z: num(d.z), ry: num(d.ry),
        hair: str(d.hair, 9, '#222222'), shirt: str(d.shirt, 9, '#c33333'), pants: str(d.pants, 9, '#333333'),
        sea: typeof d.sea === 'number' ? d.sea : 1,
        ex: d.ex && typeof d.ex === 'object' ? {
          a: str(d.ex.a, 16, ''), r: str(d.ex.r, 12, ''),
          t: typeof d.ex.t === 'number' ? Math.max(-1, Math.min(200, d.ex.t | 0)) : -1,
          p: Array.isArray(d.ex.p) ? d.ex.p.slice(0, 3).map((q) => str(q, 8, '')) : [],
          s: Math.min(6, Math.max(0.3, num(d.ex.s) || 1)), u: str(d.ex.u, 10, '')
        } : null
      };
    } else if (d.type === 'chat') {
      if (now - p.chatAt < 1200) return;
      const text = str(d.text, 80, '').replace(/[\u0000-\u001f]/g, ' ').trim();
      if (!text) return;
      p.chatAt = now;
      sendRoom(room, JSON.stringify({ type: 'chat', id, name: p.s ? p.s.name : 'Игрок', text }));
    } else if (d.type === 'dmg') {
      const k = str(d.k, 40, '');
      const dm = typeof d.d === 'number' && isFinite(d.d) && d.d > 0 ? Math.min(d.d, 5e7) : 0;
      if (!k || !dm) return;
      if (!(k in room.dealt) && Object.keys(room.dealt).length >= MAX_KEYS) return;
      room.dealt[k] = (room.dealt[k] || 0) + dm;
      room.seen[k] = now;
      room.changed[k] = room.dealt[k];
    } else if (d.type === 'mkill') {
      const k = str(d.k, 40, '');
      if (!k) return;
      delete room.dealt[k]; delete room.seen[k];
      room.changed[k] = 0;
      sendRoom(room, JSON.stringify({ type: 'mkill', k }), ws);
    } else if (d.type === 'summon') {
      if (d.k !== 'god' || now - room.godAt < 600000) return;   // Бога можно звать раз в 10 минут
      room.godAt = now;
      sendRoom(room, JSON.stringify({ type: 'summon', k: 'god', id, sid: big(d.sid), x: num(d.x), z: num(d.z) }), ws);
    } else if (d.type === 'list') {
      if (!ADMIN_KEY || d.key !== ADMIN_KEY) return;   // список игроков только для админа
      const list = [];
      room.set.forEach((c) => {
        const q = players.get(c);
        if (q && q.s) list.push({ id: q.id, name: q.s.name, x: Math.round(q.s.x), z: Math.round(q.s.z), sea: q.s.sea, me: c === ws });
      });
      ws.send(JSON.stringify({ type: 'list', room: room.n, total: wss.clients.size, rooms: rooms.map((r) => ({ n: r.n, c: r.set.size })), players: list }));
    } else if (d.type === 'adm') {
      if (!ADMIN_KEY || d.key !== ADMIN_KEY) return;   // только с ключом админа
      sendRoom(room, JSON.stringify({
        type: 'adm', id, cmd: str(d.cmd, 12, ''), k: str(d.k, 12, ''), v: str(d.v, 8, ''),
        t: num(d.t), x: num(d.x), z: num(d.z), f: num(d.f), sid: big(d.sid)
      }), ws);
    }
  });

  const leave = () => {
    players.delete(ws);
    room.set.delete(ws);
    if (!room.set.size) { room.dealt = {}; room.seen = {}; room.changed = {}; }
  };
  ws.on('close', leave);
  ws.on('error', leave);
});

// игроки рядом: 10 раз в секунду
setInterval(() => {
  rooms.forEach((r) => {
    if (!r.set.size) return;
    const list = [];
    r.set.forEach((c) => { const p = players.get(c); if (p && p.s) list.push(Object.assign({ id: p.id }, p.s)); });
    r.set.forEach((c) => {
      if (c.readyState !== 1) return;
      const me = players.get(c);
      const mine = me && me.s;
      const near = mine ? list.filter((o) => o.id === me.id || Math.hypot(o.x - mine.x, o.z - mine.z) < NEAR) : list.slice(0, 20);
      c.send(JSON.stringify({ type: 'players', players: near }));
    });
  });
}, 100);

// общий урон по боссам: 5 раз в секунду, если что-то изменилось
setInterval(() => {
  const now = Date.now();
  rooms.forEach((r) => {
    Object.keys(r.seen).forEach((k) => { if (now - r.seen[k] > 40 * 60000) { delete r.seen[k]; delete r.dealt[k]; r.changed[k] = 0; } });
    if (r.set.size && Object.keys(r.changed).length) { sendRoom(r, JSON.stringify({ type: 'bosses', b: r.changed })); r.changed = {}; }
  });
}, 200);

// отключаем «мёртвые» соединения
setInterval(() => {
  wss.clients.forEach((c) => {
    if (!c.alive) { return c.terminate(); }
    c.alive = false;
    try { c.ping(); } catch (e) {}
  });
}, 30000);

server.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
