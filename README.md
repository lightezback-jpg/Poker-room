# Poker Room (2-player starter)

A mobile-browser Texas Hold'em betting room using Express + Socket.IO. Players use physical cards; the app synchronizes virtual chips, blinds, turns, pot, and betting actions.

## Run locally
1. Install Node.js 18 or newer.
2. In this folder run `npm install`
3. Run `npm start`
4. Open `http://localhost:3000`

For two phones on the same Wi-Fi, open the computer's LAN IP on both phones.

## Put it online for different internet connections
Deploy this folder as a Node web service on a host that supports persistent WebSockets (for example Render or Railway):
- Build command: `npm install`
- Start command: `npm start`
- Set `PORT` only if your host requires it.
- Use the HTTPS URL provided by the host on both phones.

## Current limits
- Starter version supports exactly 2 players and one room per code.
- Rooms are stored in server memory; restarting/redeploying the server clears rooms.
- A disconnected player cannot reclaim their seat yet.
- Showdown winner is selected manually by the room creator after players reveal their physical cards.
- No real money, payments, or cash-out.
- This is a starter implementation, not audited for adversarial/public use. Use only with trusted friends.

## Rules in this starter
- Starting stack: 1,000 each.
- Blinds: 5/10, dealer posts small blind heads-up.
- Raise input means the player's total bet for the current street.
- The room creator starts each hand and awards the showdown pot.
