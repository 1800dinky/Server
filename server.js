const fs = require('fs');
const https = require('https');
const express = require('express');
const app = require('express')();
const socketIO = require('socket.io');
const noise = require('noisejs');
const request = require('request');
const cors = require('cors');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const Filter = require('bad-words');
const { v4: uuidv4 } = require('uuid');

app.use(cors()); // Use the 'cors' package to handle CORS settings

// Rest of your code
const io = require('socket.io')(server);

const PORT = process.env.PORT || 443;



const privateKey = fs.readFileSync('/path/to/your/private.key', 'utf8');
const certificate = fs.readFileSync('/path/to/your/certificate.crt', 'utf8');
const ca = fs.readFileSync('/path/to/your/chain.crt', 'utf8');


const credentials = {
  key: privateKey,
  cert: certificate,
  ca: ca,
};

const server = https.createServer(credentials, app);

const leetSpeakPatterns = [
  /1|\b[lI]+\b/gi, // 1, l, L, i, I
  /3|\b[eE]+\b/gi, // 3, e, E
  /4|\b[aA]+\b/gi, // 4, a, A
  /5|\b[sS]+\b/gi, // 5, s, S
  /6|\b[gG]+\b/gi, // 6, g, G
  /7|\b[tT]+\b/gi, // 7, t, T
  /8|\b[bB]+\b/gi, // 8, b, B
  /0|\b[oO]+\b/gi, // 0, o, O
];
const filter = new Filter();

let messages = [];
let connectedUsers = {};
let players = {};
const seed = Math.random();
console.log(`Perlin noise seeded with: ${seed}`);

const chatLimiter = rateLimit({
  windowMs: 1 * 1000, // 1 second
  max: 3, // limit each IP to 3 chat messages per second
  keyGenerator: (req) => req.ip,
  onLimitReached: (req) => console.log(`IP ${req.ip} has reached the chat limit`),
});

const updatePositionLimiter = rateLimit({
  windowMs: 5 * 1000, // 5 seconds
  max: 20, // limit each IP to 20 position updates per 5 seconds
  keyGenerator: (req) => req.connection && req.connection.remoteAddress ? req.connection.remoteAddress : req.ip,
  onLimitReached: (req) => console.error(`IP ${req.ip} has reached the update position limit`),
});

const chatLimiterMiddleware = (socket, next) => {
  chatLimiter(socket.request, socket.request.res, (err) => {
    if (err) {
      console.error('Error in chatLimiter:', err);
      return next(err);
    }
    updatePositionLimiter(socket.request, socket.request.res, (err) => {
      if (err) {
        console.error(`Error in updatePositionLimiter: ${err.message}`);
        return next(err);
      }
      return next();
    });
  });
};

io.use((socket, next) => {
  chatLimiterMiddleware(socket, next);
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  socket.emit('perlin seed', seed);

  socket.on('new player', (player) => {
    const schema = Joi.object({
      x: Joi.number().required(),
      y: Joi.number().required(),
      username: Joi.string().min(1).max(20).trim().required(),
    });
    const { error } = schema.validate(player);
    if (error) {
      console.log('Invalid player data:', error);
      return;
    }
    if (filter.isProfane(player.username) || player.username === 'guest') {
      socket.emit('invalid username');
      return;
    }
    if (players[socket.id]) {
      console.log('Player already exists:', socket.id);
      return;
    }
    if (Object.values(players).some((p) => p.username === player.username)) {
      console.log('Username already taken:', player.username);
      socket.emit('username taken');
      return;
    }
    players[socket.id] = player;
    connectedUsers[socket.id] = { username: player.username, status: 'online' };
    io.emit('user presence', connectedUsers);

    const playerList = Object.entries(players).map(([id, player]) => ({
      id,
      username: player.username,
    }));

    io.emit('player list', playerList);

    socket.emit('username chosen', player.username);
  });

  socket.on('chat message', (msg) => {
    const schema = Joi.string().min(1).max(100).required();
    const { error } = schema.validate(msg);
    if (error) {
      console.log('Invalid message data:', error);
      return;
    }
    chatLimiterMiddleware(socket, () => {
      if (filter.isProfane(msg)) {
        console.log('Message contains profanity:', msg);
        return;
      }
      for (const pattern of leetSpeakPatterns) {
        if (pattern.test(msg)) {
          console.log('Blocked leet speak profanity:', msg);
          return;
        }
      }
      const message = {
        id: uuidv4(),
        username: players[socket.id].username,
        msg: msg,
        reactions: {},
      };
      messages.push(message);
      io.emit('chat message', message);
    });
  });

  socket.on('update position', (player) => {
    const schema = Joi.object({
      x: Joi.number().required(),
      y: Joi.number().required(),
      username: Joi.string().min(1).max(20).required(),
    });
    const { error } = schema.validate(player);
    if (error) {
      console.log('Invalid position data:', error);
      return;
    }
    if (!players[socket.id]) {
      console.log('Player does not exist:', socket.id);
      return;
    }
    players[socket.id] = { x: player.x, y: player.y, username: player.username }; // update the player's x, y, and username
    socket.broadcast.emit('update position', { id: socket.id, player });
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    delete players[socket.id];
    delete connectedUsers[socket.id];
    io.emit('player disconnected', socket.id);
    io.emit('user presence', connectedUsers);

    const playerList = Object.entries(players).map(([id, player]) => ({
      id,
      username: player.username,
    }));

    io.emit('player list', playerList);
  });
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

