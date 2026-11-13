const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();
const STARTING = 1000, SMALL = 5, BIG = 10;

function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6}, () => chars[crypto.randomInt(chars.length)]).join("");
}
function cleanRoom(room) {
  return {
    code: room.code, players: room.players.map(p => ({
      name:p.name, chips:p.chips, seat:p.seat, connected:p.connected
    })),
    handNo: room.handNo, dealer: room.dealer, street: room.street,
    pot: room.pot, currentBet: room.currentBet, contributions: room.contributions,
    acted: room.acted, turn: room.turn, status: room.status, message: room.message,
    smallBlind: SMALL, bigBlind: BIG
  };
}
function emitRoom(room) { io.to(room.code).emit("state", cleanRoom(room)); }
function player(room, sid) { return room.players.find(p => p.sid === sid); }
function startHand(room) {
  if (room.players.length !== 2 || room.players.some(p => p.chips <= 0)) {
    room.status = "waiting"; room.street = "waiting"; room.turn = null;
    room.message = "Waiting for two players with chips.";
    emitRoom(room); return;
  }
  room.handNo++;
  room.street = "preflop"; room.status = "playing";
  room.dealer = room.handNo % 2 === 1 ? 0 : 1;
  room.pot = 0; room.currentBet = BIG;
  room.contributions = [0,0]; room.acted = [];
  const sb = room.dealer, bb = 1 - sb;
  room.players[sb].chips -= SMALL; room.contributions[sb] = SMALL; room.pot += SMALL;
  room.players[bb].chips -= BIG; room.contributions[bb] = BIG; room.pot += BIG;
  room.turn = sb;
  room.message = `Hand ${room.handNo}: ${room.players[sb].name} posts small blind; ${room.players[bb].name} posts big blind.`;
  emitRoom(room);
}
function finishStreet(room) {
  if (room.street === "preflop") room.street = "flop";
  else if (room.street === "flop") room.street = "turn";
  else if (room.street === "turn") room.street = "river";
  else { room.street = "showdown"; room.status = "showdown"; room.turn = null;
    room.message = "Showdown: reveal cards and select the winner."; emitRoom(room); return; }
  room.currentBet = 0; room.contributions = [0,0]; room.acted = [];
  room.turn = 1 - room.dealer;
  room.message = `${room.street.toUpperCase()}: betting starts.`;
  emitRoom(room);
}
function nextTurn(room, idx) {
  const other = 1 - idx;
  const bothActed = room.acted.includes(0) && room.acted.includes(1);
  const matched = room.contributions[0] === room.contributions[1];
  if (bothActed && matched) { finishStreet(room); return; }
  room.turn = other;
  emitRoom(room);
}
function settle(room, winnerIdx) {
  room.players[winnerIdx].chips += room.pot;
  const won = room.pot;
  room.pot = 0; room.currentBet = 0; room.contributions = [0,0];
  room.acted = []; room.status = "complete"; room.street = "complete";
  room.turn = null;
  room.message = `${room.players[winnerIdx].name} wins ${won} chips. Start the next hand when ready.`;
  emitRoom(room);
}
io.on("connection", socket => {
  socket.on("create", ({name}, cb) => {
    let c; do { c = code(); } while (rooms.has(c));
    const room = {code:c, players:[{sid:socket.id,name:String(name||"Player 1").slice(0,18),chips:STARTING,seat:0,connected:true}],
      handNo:0,dealer:1,street:"waiting",pot:0,currentBet:0,contributions:[0,0],acted:[],turn:null,status:"waiting",message:"Room created. Waiting for Player 2."};
    rooms.set(c,room); socket.join(c); cb({ok:true,code:c}); emitRoom(room);
  });
  socket.on("join", ({code:c,name}, cb) => {
    c = String(c||"").toUpperCase().trim(); const room = rooms.get(c);
    if (!room) return cb({ok:false,error:"Room not found. Check the code."});
    if (room.players.length >= 2) return cb({ok:false,error:"This room is full (2 players)."});
    room.players.push({sid:socket.id,name:String(name||"Player 2").slice(0,18),chips:STARTING,seat:1,connected:true});
    socket.join(c); cb({ok:true,code:c}); room.message = "Both players joined. Host can start the first hand."; emitRoom(room);
  });
  socket.on("startHand", cb => {
    const room = [...rooms.values()].find(r => player(r,socket.id));
    if (!room || room.players[0].sid !== socket.id) return cb?.({ok:false,error:"Only the room creator can start a hand."});
    if (room.status === "playing" || room.status === "showdown") return cb?.({ok:false,error:"This hand is still active."});
    if (room.players.length !== 2) return cb?.({ok:false,error:"Need two players."});
    startHand(room); cb?.({ok:true});
  });
  socket.on("action", ({action,raiseTo}, cb) => {
    const room = [...rooms.values()].find(r => player(r,socket.id));
    if (!room || room.status !== "playing") return cb?.({ok:false,error:"No active hand."});
    const p = player(room,socket.id), idx = p.seat;
    if (room.turn !== idx) return cb?.({ok:false,error:"It is not your turn."});
    const owed = room.currentBet - room.contributions[idx];
    if (action === "fold") {
      settle(room,1-idx); cb?.({ok:true}); return;
    }
    if (action === "check" && owed !== 0) return cb?.({ok:false,error:"You cannot check; call or fold."});
    if (action === "call") {
      const amount = Math.min(owed,p.chips); p.chips -= amount;
      room.contributions[idx] += amount; room.pot += amount;
      room.acted.push(idx); room.message = `${p.name} calls ${amount}.`;
      nextTurn(room,idx); cb?.({ok:true}); return;
    }
    if (action === "check") {
      room.acted.push(idx); room.message = `${p.name} checks.`;
      nextTurn(room,idx); cb?.({ok:true}); return;
    }
    if (action === "raise") {
      const target = Number(raiseTo);
      const minRaise = room.currentBet === 0 ? BIG : room.currentBet + BIG;
      if (!Number.isFinite(target) || target < minRaise || target <= room.currentBet)
        return cb?.({ok:false,error:`Minimum total street bet is ${minRaise}.`});
      const add = target - room.contributions[idx];
      if (add > p.chips) return cb?.({ok:false,error:"Not enough chips."});
      p.chips -= add; room.contributions[idx] = target; room.pot += add;
      room.currentBet = target; room.acted = [idx];
      room.message = `${p.name} raises to ${target}.`;
      room.turn = 1-idx; emitRoom(room); cb?.({ok:true}); return;
    }
    cb?.({ok:false,error:"Unknown action."});
  });
  socket.on("award", ({winner}, cb) => {
    const room = [...rooms.values()].find(r => player(r,socket.id));
    if (!room || room.status !== "showdown" || room.players[0].sid !== socket.id)
      return cb?.({ok:false,error:"Only the host can award the showdown pot."});
    if (![0,1].includes(Number(winner))) return cb?.({ok:false,error:"Choose a player."});
    settle(room,Number(winner)); cb?.({ok:true});
  });
  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const p = player(room,socket.id);
      if (p) { p.connected = false; room.message = `${p.name} disconnected. They can rejoin only by creating/joining a fresh room in this starter version.`; emitRoom(room); }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Poker room listening on ${port}`));