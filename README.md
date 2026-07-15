# NEON DRIFT

A 2D neon space-dodger built with plain HTML5 Canvas + JavaScript — no frameworks, no build step.

**[Play it live](#)** *(link added after GitHub Pages deploy)*

## Gameplay

Dodge glowing crystal shards, collect energy orbs to build your combo multiplier, and survive as long as you can. Difficulty ramps up the longer you last.

- **Move:** Arrow keys / WASD
- **Touch:** Drag anywhere on screen
- 3 lives, brief invulnerability after each hit
- Score = survival time × combo + orb pickups
- Top 10 scores are saved locally in your browser (`localStorage`) — no server, no account needed

## Features

- Particle-based effects: engine trail, collection bursts, explosion debris
- Parallax starfield + drifting nebula background
- Screen shake and hit-flash feedback
- Fully responsive canvas (desktop + mobile)
- Persistent local leaderboard with name entry for new high scores

## Running locally

Just open `index.html` in a browser, or serve the folder with any static file server:

```bash
npx serve .
```

## Tech

Vanilla JS, HTML5 Canvas 2D API, CSS. No dependencies, no build tooling.
