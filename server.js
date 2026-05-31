const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Game State
let currentSeed = Math.floor(Math.random() * 1000000);
let players = {}; // id: { id, x, y, z, yaw, pitch, health, armor, score, name, color, active }
let drones = {};  // id: { id, x, y, z, health, type, state: 'patrol'|'chase', targetId, vx, vz }
let items = {};   // id: { id, x, z, type: 'ammo'|'health', collected: false }
let bossSpawned = false;
let gameStatus = 'active'; // active, won
let escapePortal = { x: 15, z: 15 }; // Cell coords for 17x17 grid (max-2, max-2)
let mazeGrid = null; // Generated 2D array representation

// Simple Maze Generation on Server for AI validation & item placement
function generateServerMaze(seed) {
    const size = 17;
    const grid = Array(size).fill(null).map(() => Array(size).fill(1)); // 1 = wall, 0 = empty

    // Simple deterministic random based on seed
    let rState = seed;
    function random() {
        let x = Math.sin(rState++) * 10000;
        return x - Math.floor(x);
    }

    // DFS Maze generator
    const stack = [];
    grid[1][1] = 0;
    stack.push([1, 1]);

    while (stack.length > 0) {
        const [cx, cz] = stack[stack.length - 1];
        const neighbors = [];

        const dirs = [
            [0, -2], [0, 2], [-2, 0], [2, 0]
        ];

        for (const [dx, dz] of dirs) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx > 0 && nx < size - 1 && nz > 0 && nz < size - 1) {
                if (grid[nz][nx] === 1) {
                    neighbors.push([nx, nz, dx, dz]);
                }
            }
        }

        if (neighbors.length > 0) {
            // Pick a random neighbor using our seed-based random
            const idx = Math.floor(random() * neighbors.length);
            const [nx, nz, dx, dz] = neighbors[idx];
            grid[cz + dz / 2][cx + dx / 2] = 0;
            grid[nz][nx] = 0;
            stack.push([nx, nz]);
        } else {
            stack.pop();
        }
    }

    // Open up ~12% of inner walls to create combat arenas
    for (let z = 1; z < size - 1; z++) {
        for (let x = 1; x < size - 1; x++) {
            if (grid[z][x] === 1) {
                // Check if it's an inner wall (not border)
                if (random() < 0.12) {
                    grid[z][x] = 0;
                }
            }
        }
    }

    // Ensure spawn (1,1) and exit (15,15) are open
    grid[1][1] = 0;
    grid[15][15] = 0;

    return grid;
}

// Spawns items and drones based on the grid
function spawnEntities() {
    drones = {};
    items = {};
    bossSpawned = false;
    
    let droneIdCounter = 0;
    let itemIdCounter = 0;
    
    let rState = currentSeed + 42;
    function random() {
        let x = Math.sin(rState++) * 10000;
        return x - Math.floor(x);
    }

    const cellSize = 4.0; // scale factor matches game.js

    // Find all empty cells (excluding spawn (1,1) area)
    const emptyCells = [];
    for (let z = 1; z < 16; z++) {
        for (let x = 1; x < 16; x++) {
            if (mazeGrid[z][x] === 0 && !(x <= 2 && z <= 2)) {
                emptyCells.push({ x, z });
            }
        }
    }

    // Shuffle empty cells
    for (let i = emptyCells.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const temp = emptyCells[i];
        emptyCells[i] = emptyCells[j];
        emptyCells[j] = temp;
    }

    // Spawn 8 regular drones
    const droneCount = Math.min(8, emptyCells.length);
    for (let i = 0; i < droneCount; i++) {
        const cell = emptyCells.pop();
        const dId = `drone_${droneIdCounter++}`;
        drones[dId] = {
            id: dId,
            x: cell.x * cellSize,
            y: 1.5,
            z: cell.z * cellSize,
            health: 100,
            type: 'regular',
            state: 'patrol',
            targetId: null,
            angle: random() * Math.PI * 2,
            speed: 1.5 + random() * 1.0,
            cooldown: 0
        };
    }

    // Spawn Boss Drone near the escape portal
    const bossCell = { x: 14, z: 14 }; // near 15,15
    if (mazeGrid[14][14] === 0 || mazeGrid[14][15] === 0 || mazeGrid[15][14] === 0) {
        const bId = 'drone_boss';
        drones[bId] = {
            id: bId,
            x: 14.0 * cellSize,
            y: 2.5,
            z: 14.0 * cellSize,
            health: 500,
            type: 'boss',
            state: 'patrol',
            targetId: null,
            angle: 0,
            speed: 1.0,
            cooldown: 0
        };
        bossSpawned = true;
    }

    // Spawn items (4 health kits, 6 ammo crates)
    const itemCount = Math.min(10, emptyCells.length);
    for (let i = 0; i < itemCount; i++) {
        const cell = emptyCells.pop();
        const type = (i < 4) ? 'health' : 'ammo';
        const itId = `item_${itemIdCounter++}`;
        items[itId] = {
            id: itId,
            x: cell.x * cellSize,
            z: cell.z * cellSize,
            type: type,
            collected: false
        };
    }
}

// Generate the initial maze grid on server start
mazeGrid = generateServerMaze(currentSeed);
spawnEntities();

// Broadcast a message to all connected clients
function broadcast(data, excludeId = null) {
    const message = JSON.stringify(data);
    Object.keys(players).forEach(id => {
        if (id !== excludeId && players[id].ws.readyState === WebSocket.OPEN) {
            players[id].ws.send(message);
        }
    });
}

// Main AI Update Loop (20Hz)
setInterval(() => {
    if (gameStatus !== 'active') return;

    let droneUpdates = [];
    const cellSize = 4.0;
    
    // Update drones patrol/chase movement
    Object.keys(drones).forEach(id => {
        const drone = drones[id];
        if (drone.health <= 0) return;

        // Decrease fire cooldown
        if (drone.cooldown > 0) {
            drone.cooldown -= 0.05; // tick is 50ms
        }

        // AI Logic: Find nearest player
        let nearestPlayer = null;
        let minDist = 22.0; // radially alert range: 22 meters
        
        Object.keys(players).forEach(pId => {
            const p = players[pId];
            if (!p.active || p.health <= 0) return;

            const dx = p.x - drone.x;
            const dz = p.z - drone.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist < minDist) {
                // Check simple line-of-sight on server
                if (hasLineOfSight(drone.x, drone.z, p.x, p.z)) {
                    minDist = dist;
                    nearestPlayer = p;
                }
            }
        });

        if (nearestPlayer) {
            drone.state = 'chase';
            drone.targetId = nearestPlayer.id;

            // Move towards player
            const dx = nearestPlayer.x - drone.x;
            const dz = nearestPlayer.z - drone.z;
            const angle = Math.atan2(dz, dx);
            drone.angle = angle;
            
            const vx = Math.cos(angle) * drone.speed;
            const vz = Math.sin(angle) * drone.speed;

            // Apply movement on server (with simple collision check against grid)
            moveEntityWithGrid(drone, vx * 0.05, vz * 0.05);

            // Fire at player
            if (drone.cooldown <= 0) {
                drone.cooldown = drone.type === 'boss' ? 0.8 : 1.5;
                broadcast({
                    type: 'droneShoot',
                    droneId: drone.id,
                    x: drone.x,
                    y: drone.y,
                    z: drone.z,
                    targetX: nearestPlayer.x,
                    targetY: nearestPlayer.y || 1.2,
                    targetZ: nearestPlayer.z
                });
            }
        } else {
            drone.state = 'patrol';
            drone.targetId = null;

            // Patrol: Move forward, bounce or change direction on walls
            const vx = Math.cos(drone.angle) * drone.speed;
            const vz = Math.sin(drone.angle) * drone.speed;

            const moved = moveEntityWithGrid(drone, vx * 0.05, vz * 0.05);
            if (!moved) {
                // Turn randomly if hit a wall
                drone.angle += Math.PI * 0.5 + Math.random() * Math.PI;
            }
        }

        droneUpdates.push({
            id: drone.id,
            x: drone.x,
            y: drone.y,
            z: drone.z,
            state: drone.state,
            targetId: drone.targetId,
            health: drone.health
        });
    });

    if (droneUpdates.length > 0) {
        broadcast({
            type: 'dronesUpdate',
            drones: droneUpdates
        });
    }
}, 50);

// Helper: check Server-side Line of Sight through voxel maze grid
function hasLineOfSight(x1, z1, x2, z2) {
    const cellSize = 4.0;
    // Basic DDA / Raycast grid traversal
    let cellX1 = Math.floor(x1 / cellSize);
    let cellZ1 = Math.floor(z1 / cellSize);
    const cellX2 = Math.floor(x2 / cellSize);
    const cellZ2 = Math.floor(z2 / cellSize);

    const dx = x2 - x1;
    const dz = z2 - z1;
    const distance = Math.sqrt(dx*dx + dz*dz);
    if (distance === 0) return true;

    const steps = Math.ceil(distance * 3); // fine step sizing
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const testX = x1 + dx * t;
        const testZ = z1 + dz * t;
        const cx = Math.floor(testX / cellSize);
        const cz = Math.floor(testZ / cellSize);
        if (cx < 0 || cx >= 17 || cz < 0 || cz >= 17) return false;
        if (mazeGrid[cz][cx] === 1) return false; // hit wall block
    }
    return true;
}

// Helper: move entity with independent X and Z sliding collisions against the maze grid
function moveEntityWithGrid(entity, dx, dz) {
    const cellSize = 4.0;
    const radius = 0.6;
    let originalX = entity.x;
    let originalZ = entity.z;

    // Try moving on X
    entity.x += dx;
    if (checkGridCollision(entity.x, entity.z, radius)) {
        entity.x = originalX; // slide
    }

    // Try moving on Z
    entity.z += dz;
    if (checkGridCollision(entity.x, entity.z, radius)) {
        entity.z = originalZ; // slide
    }

    return (entity.x !== originalX || entity.z !== originalZ);
}

function checkGridCollision(px, pz, radius) {
    const cellSize = 4.0;
    const halfCell = cellSize / 2;
    
    const centerGridX = Math.round(px / cellSize);
    const centerGridZ = Math.round(pz / cellSize);
    
    for (let cz = centerGridZ - 1; cz <= centerGridZ + 1; cz++) {
        for (let cx = centerGridX - 1; cx <= centerGridX + 1; cx++) {
            if (cx < 0 || cx >= 17 || cz < 0 || cz >= 17) {
                return true;
            }
            if (mazeGrid[cz][cx] === 1) {
                const minX = cx * cellSize - halfCell;
                const maxX = cx * cellSize + halfCell;
                const minZ = cz * cellSize - halfCell;
                const maxZ = cz * cellSize + halfCell;
                
                const closestX = Math.max(minX, Math.min(px, maxX));
                const closestZ = Math.max(minZ, Math.min(pz, maxZ));
                
                const dx = px - closestX;
                const dz = pz - closestZ;
                const distSq = dx * dx + dz * dz;
                
                if (distSq < radius * radius) {
                    return true;
                }
            }
        }
    }
    return false;
}

// Websocket Events Router
wss.on('connection', (ws) => {
    const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
    const colors = [0x00aaff, 0xffaa00, 0x00ffaa, 0xff00aa, 0xaaff00, 0xaa00ff];
    const color = colors[Math.floor(Math.random() * colors.length)];

    console.log(`Player connected: ${playerId}`);

    players[playerId] = {
        id: playerId,
        x: 4.0, // (1, 1) cell coordinates at scale 4
        y: 1.2,
        z: 4.0,
        yaw: 0,
        pitch: 0,
        health: 100,
        armor: 100,
        score: 10000,
        name: `Runner_${playerId.substr(-4)}`,
        color: color,
        active: true,
        ws: ws
    };

    // Send Init Setup Data to this client
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        seed: currentSeed,
        players: Object.keys(players).map(id => ({
            id: players[id].id,
            x: players[id].x,
            y: players[id].y,
            z: players[id].z,
            yaw: players[id].yaw,
            pitch: players[id].pitch || 0, // pitch sync added
            color: players[id].color,
            name: players[id].name,
            health: players[id].health,
            armor: players[id].armor,
            score: players[id].score
        })),
        drones: Object.keys(drones).map(id => ({
            id: drones[id].id,
            x: drones[id].x,
            y: drones[id].y,
            z: drones[id].z,
            health: drones[id].health,
            type: drones[id].type,
            state: drones[id].state
        })),
        items: Object.keys(items).map(id => ({
            id: items[id].id,
            x: items[id].x,
            z: items[id].z,
            type: items[id].type,
            collected: items[id].collected
        }))
    }));

    // Broadcast Join Event to other players
    broadcast({
        type: 'playerJoined',
        player: {
            id: playerId,
            x: players[playerId].x,
            y: players[playerId].y,
            z: players[playerId].z,
            yaw: players[playerId].yaw,
            pitch: players[playerId].pitch || 0, // pitch sync added
            color: players[playerId].color,
            name: players[playerId].name,
            health: players[playerId].health,
            armor: players[playerId].armor
        }
    }, playerId);

    // Messages Router
    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch(e) {
            return;
        }

        const p = players[playerId];
        if (!p) return;

        switch (data.type) {
            case 'update':
                // Rapid position updates from client
                p.x = data.x;
                p.y = data.y;
                p.z = data.z;
                p.yaw = data.yaw;
                p.pitch = data.pitch;
                p.health = data.health;
                p.armor = data.armor;
                p.score = data.score;

                // Sync details to other players
                broadcast({
                    type: 'playerMoved',
                    id: playerId,
                    x: p.x,
                    y: p.y,
                    z: p.z,
                    yaw: p.yaw,
                    pitch: p.pitch,
                    health: p.health,
                    armor: p.armor,
                    score: p.score
                }, playerId);
                break;

            case 'shoot':
                // Slingshot shot fired! Sync to other players
                broadcast({
                    type: 'playerShot',
                    senderId: playerId,
                    x: data.x,
                    y: data.y,
                    z: data.z,
                    vx: data.vx,
                    vy: data.vy,
                    vz: data.vz
                }, playerId);
                break;

            case 'droneHit':
                // A player reported hitting a drone
                const d = drones[data.droneId];
                if (d && d.health > 0) {
                    d.health = Math.max(0, d.health - data.damage);
                    
                    broadcast({
                        type: 'droneDamaged',
                        droneId: d.id,
                        health: d.health,
                        damage: data.damage,
                        killerId: d.health <= 0 ? playerId : null
                    });

                    // Add score to player on server
                    if (d.health <= 0) {
                        p.score += 600; // +600 points per drone destroyed
                    }
                }
                break;

            case 'playerHit':
                // Player took damage
                p.health = Math.max(0, p.health - data.damage);
                broadcast({
                    type: 'playerDamaged',
                    id: playerId,
                    health: p.health,
                    damage: data.damage
                });
                break;

            case 'pickup':
                // Item collected
                const item = items[data.itemId];
                if (item && !item.collected) {
                    item.collected = true;
                    broadcast({
                        type: 'itemCollected',
                        itemId: item.id,
                        pickerId: playerId,
                        itemType: item.type
                    });

                    // Server respawns item after 15 seconds
                    setTimeout(() => {
                        item.collected = false;
                        broadcast({
                            type: 'itemRespawned',
                            itemId: item.id,
                            x: item.x,
                            z: item.z,
                            itemType: item.type
                        });
                    }, 15000);
                }
                break;

            case 'win':
                // Player reached gold escape portal
                if (gameStatus === 'active') {
                    gameStatus = 'won';
                    broadcast({
                        type: 'gameOver',
                        winnerId: playerId,
                        name: p.name,
                        score: p.score,
                        time: data.time
                    });

                    // Restart game state after 10 seconds
                    setTimeout(() => {
                        currentSeed = Math.floor(Math.random() * 1000000);
                        mazeGrid = generateServerMaze(currentSeed);
                        spawnEntities();
                        gameStatus = 'active';

                        Object.keys(players).forEach(id => {
                            players[id].health = 100;
                            players[id].armor = 100;
                            players[id].score = 10000;
                            players[id].x = 4.0;
                            players[id].z = 4.0;
                        });

                        broadcast({
                            type: 'restartGame',
                            seed: currentSeed,
                            drones: Object.keys(drones).map(id => ({
                                id: drones[id].id,
                                x: drones[id].x,
                                y: drones[id].y,
                                z: drones[id].z,
                                health: drones[id].health,
                                type: drones[id].type,
                                state: drones[id].state
                            })),
                            items: Object.keys(items).map(id => ({
                                id: items[id].id,
                                x: items[id].x,
                                z: items[id].z,
                                type: items[id].type,
                                collected: items[id].collected
                            }))
                        });
                    }, 10000);
                }
                break;

            case 'nameChange':
                p.name = data.name.replace(/[^a-zA-Z0-9_]/g, '').substr(0, 12) || `Player_${playerId.substr(-4)}`;
                broadcast({
                    type: 'playerRenamed',
                    id: playerId,
                    name: p.name
                });
                break;

            case 'chat':
                broadcast({
                    type: 'chat',
                    senderName: p.name,
                    senderColor: p.color,
                    text: data.text.substr(0, 80)
                });
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Player disconnected: ${playerId}`);
        delete players[playerId];
        broadcast({
            type: 'playerLeft',
            id: playerId
        });

        // Reset game if no players left
        if (Object.keys(players).length === 0) {
            gameStatus = 'active';
        }
    });
});

server.listen(PORT, () => {
    console.log(`Scape Runner Multiplayer Server running on port ${PORT}`);
});
