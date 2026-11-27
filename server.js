// Сервер мультиплеера «Монета смерти». Запуск: node server.js
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';   // секретный ключ админа (задаётся на Render)
const MAX_PLAYERS = 50;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Монета смерти: сервер работает. Игроков: ' + wss.clients.size);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const players = new Map(); // ws -> { id, s }

const num = (v) => (typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e6 ? v : 0);
const str = (v, n, d) => (typeof v === 'string' ? v.slice(0, n) : d);

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) { ws.close(1013, 'full'); return; }
  const id = crypto.randomBytes(4).toString('hex');
  players.set(ws, { id, s: null, last: 0 });
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.send(JSON.stringify({ type: 'welcome', id }));

  ws.on('message', (raw) => {
    const p = players.get(ws);
    if (!p) return;
    const now = Date.now();
    if (now - p.last < 40) return;               // не чаще 25 сообщений в секунду
    p.last = now;
    let d;
    try { d = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;

    if (d.type === 'state') {
      p.s = {
        name: str(d.name, 16, 'Игрок'),
        x: num(d.x), y: num(d.y), z: num(d.z), ry: num(d.ry),
        hair: str(d.hair, 9, '#222222'), shirt: str(d.shirt, 9, '#c33333'), pants: str(d.pants, 9, '#333333'),
        sea: typeof d.sea === 'number' ? d.sea : 1
      };
    } else if (d.type === 'adm') {
      // команды админа принимаются только с верным ключом
      if (!ADMIN_KEY || d.key !== ADMIN_KEY) return;
      const msg = JSON.stringify({
        type: 'adm', id, cmd: str(d.cmd, 12, ''),
        t: num(d.t), x: num(d.x), z: num(d.z), f: num(d.f), v: str(d.v, 8, '')
      });
      wss.clients.forEach((c) => { if (c !== ws && c.readyState === 1) c.send(msg); });
    }
  });

  ws.on('close', () => { players.delete(ws); });
  ws.on('error', () => { players.delete(ws); });
});

// рассылка списка игроков 10 раз в секунду
setInterval(() => {
  if (!wss.clients.size) return;
  const list = [];
  players.forEach((p) => { if (p.s) list.push(Object.assign({ id: p.id }, p.s)); });
  const msg = JSON.stringify({ type: 'players', players: list });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}, 100);

// отключаем «мёртвые» соединения
setInterval(() => {
  wss.clients.forEach((c) => {
    if (!c.alive) { players.delete(c); return c.terminate(); }
    c.alive = false;
    try { c.ping(); } catch (e) {}
  });
}, 30000);

server.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
