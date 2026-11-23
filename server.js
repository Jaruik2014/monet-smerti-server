const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Moneta Smerti Server is running!');
});

const wss = new WebSocketServer({ server });
const players = new Map();
let nextId = 1;

function broadcast(data, exceptWs = null) {
  const raw = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== exceptWs && client.readyState === 1) {
      client.send(raw);
    }
  }
}

wss.on('connection', (ws) => {
  const id = 'p_' + nextId++;
  const player = { id, name: 'Игрок', hair: '#3a2a1a', shirt: '#3b82d6', pants: '#33405a', x: 0, y: 0, z: 10, ry: 0 };
  players.set(id, player);

  ws.send(JSON.stringify({
    type: 'init',
    id,
    players: [...players.values()]
  }));

  broadcast({ type: 'join', player }, ws);

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === 'state') {
      Object.assign(player, {
        name: String(msg.name || 'Игрок').slice(0, 16),
        hair: msg.hair || player.hair,
        shirt: msg.shirt || player.shirt,
        pants: msg.pants || player.pants,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        z: Number(msg.z) || 10,
        ry: Number(msg.ry) || 0
      });
      broadcast({ type: 'state', ...player }, ws);
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
  });
});

server.listen(PORT, () => console.log('Listening on', PORT));
