// core game simulation script: Scape Runner client
import { playShoot, playEnemyHit, playPlayerHit, playPickup } from './sound.js';
import { generateTextures } from './textures.js';
import { generateMaze, getBiomeForCell } from './maze.js';

// Game variables
let scene, camera, renderer;
let textures = {};
let mazeGrid = [];
const cellSize = 4.0;
const wallHeight = 4.0;

// Player states
let localPlayerId = null;
let playerName = 'SOBREVIVENTE';
let playerColor = 0x00aaff;
let playerHealth = 100;
let playerArmor = 100;
let playerScore = 10000;
let playerAmmo = 10;
const maxAmmo = 10;

// Movement
let playerPos = new THREE.Vector3(4.0, 1.2, 4.0); // Center of grid cell (1,1)
let playerVelocity = new THREE.Vector3();
let yaw = 0;
let pitch = 0;
const moveSpeed = 7.0;
const sensitivity = 0.0022;
let keys = { w: false, a: false, s: false, d: false };

// Camera bobbing
let bobTime = 0;
let isMoving = false;

// Slingshot State
// States: 'idle', 'stretch', 'snap', 'recover'
let slingshotState = 'idle';
let slingshotStretch = 0.0; // 0 to 1
let slingshotAnimTime = 0;
let speedLines = [];

// Projectiles & Particles
let stones = []; // local visual physics stones
let particles = []; // voxel hit particles

// Multiplayer WebSockets
let ws = null;
let otherPlayers = {}; // id: { id, mesh, name, color, health }
let drones = {}; // id: { id, mesh, targetId, health, type, state }
let items = {}; // id: { id, mesh, type, collected }

// Canvases
let slingshotCanvas, slingshotCtx;
let minimapCanvas, minimapCtx;
let portraitCanvas, portraitCtx;

// Local High Score
let bestTime = localStorage.getItem('scape_runner_best_time') || '--:--';

// Timer and Score
let speedrunTimer = 0.0;
let runActive = false;
let gameStatus = 'menu'; // menu, active, won, gameover

// Portrait animations
let portraitState = 'idle'; // idle, shoot, damaged, dead
let portraitAnimTimer = 0;
let portraitLookAngle = 0;

// UI Elements
const loadingScreen = document.getElementById('loading-screen');
const menuScreen = document.getElementById('menu-screen');
const pauseScreen = document.getElementById('pause-screen');
const winScreen = document.getElementById('win-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const gameHud = document.getElementById('game-hud');
const btnPlay = document.getElementById('btn-play');
const btnResume = document.getElementById('btn-resume');
const btnRespawn = document.getElementById('btn-respawn');
const btnToMenu = document.getElementById('btn-to-menu');
const playerNameInput = document.getElementById('player-name-input');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const playerList = document.getElementById('player-list');

// Initialize Game Engine on Page Load
window.addEventListener('DOMContentLoaded', () => {
    // Generate pre-filled random name
    playerNameInput.value = 'CORREDOR_' + Math.floor(Math.random() * 9000 + 1000);
    
    // Choose Color picker logic
    const colorOpts = document.querySelectorAll('.color-opt');
    colorOpts.forEach(opt => {
        opt.addEventListener('click', (e) => {
            colorOpts.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            playerColor = parseInt(opt.getAttribute('data-color'), 16);
        });
    });

    // Wire up buttons
    btnPlay.addEventListener('click', startGame);
    btnResume.addEventListener('click', () => document.body.requestPointerLock());
    
    // Game Over screen wires
    btnRespawn.addEventListener('click', respawnPlayer);
    btnToMenu.addEventListener('click', () => {
        window.location.reload();
    });

    initHUDCanvases();
    
    // Fetch initial persistent high scores on page load
    fetch('/api/highscores')
        .then(res => res.json())
        .then(data => populateLeaderboard(data))
        .catch(err => console.error("Error loading highscores on startup:", err));

    // Start game loading
    setTimeout(() => {
        loadingScreen.classList.remove('active');
        menuScreen.classList.add('active');
    }, 1500);
});

// Setup 2D Canvas Overlays
function initHUDCanvases() {
    slingshotCanvas = document.getElementById('slingshot-canvas');
    slingshotCtx = slingshotCanvas.getContext('2d');
    resizeSlingshotCanvas();

    minimapCanvas = document.getElementById('minimap-canvas');
    minimapCtx = minimapCanvas.getContext('2d');

    portraitCanvas = document.getElementById('portrait-canvas');
    portraitCtx = portraitCanvas.getContext('2d');
    
    window.addEventListener('resize', resizeSlingshotCanvas);
}

function resizeSlingshotCanvas() {
    const isMobile = window.innerWidth <= 768;
    slingshotCanvas.width = isMobile ? 320 : 500;
    slingshotCanvas.height = isMobile ? 256 : 400;
}

// -------------------------------------------------------------
// GAME LAUNCH
// -------------------------------------------------------------
function startGame() {
    playerName = playerNameInput.value.trim().substring(0, 12) || 'RECRUTA';
    menuScreen.classList.remove('active');
    document.body.classList.add('in-game');
    
    // Initialize procedural audio context on user gesture
    if (window.initAudioContext) window.initAudioContext();

    init3D();
    connectWebSocket();
    setupInputListeners();
    
    document.body.requestPointerLock();
    gameStatus = 'active';
    runActive = true;
    speedrunTimer = 0;
    
    // Start Game Loops
    animate();
}

// Setup Three.js 3D Pipeline
function init3D() {
    // 1. Scene setup
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0e17, 0.02); // Softened fog density for improved sight range

    // 2. Camera setup
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.rotation.order = 'YXZ';
    camera.position.copy(playerPos);

    // 3. Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0e17);
    
    const container = document.getElementById('game-container');
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Lighting (Boosted for superior contrast & natural texture colors)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55); // More general visibility
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.70); // High contrast directional white highlights
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    // Load dynamic procedural textures
    textures = generateTextures();

    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// -------------------------------------------------------------
// NETWORKING: WebSocket client
// -------------------------------------------------------------
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(socketUrl);

    ws.onopen = () => {
        // Send initial setup name
        ws.send(JSON.stringify({
            type: 'nameChange',
            name: playerName
        }));
        
        // Add chat welcome
        addChatMessage('SOBREVIVÊNCIA', '#ffff33', 'Conectado à rede de fuga do Scape Runner! Cada um por si. Corre para sobreviver!');
    };

    ws.onmessage = (event) => {
        let msg = JSON.parse(event.data);
        
        switch (msg.type) {
            case 'init':
                localPlayerId = msg.playerId;
                if (msg.highScores) {
                    populateLeaderboard(msg.highScores);
                }
                // Generate identical maze using server's seed
                buildLabyrinth(msg.seed);
                
                // Sync existing entities
                msg.players.forEach(p => {
                    if (p.id !== localPlayerId) {
                        spawnOtherPlayer(p);
                    }
                });

                msg.drones.forEach(d => {
                    spawnDroneMesh(d);
                });

                msg.items.forEach(it => {
                    spawnItemMesh(it);
                });
                break;

            case 'playerJoined':
                spawnOtherPlayer(msg.player);
                addChatMessage('SISTEMA', '#00ffaa', `${msg.player.name} juntou-se ao esquadrão!`);
                break;

            case 'playerLeft':
                removeOtherPlayer(msg.id);
                break;

            case 'playerMoved':
                const op = otherPlayers[msg.id];
                if (op) {
                    op.targetPos.set(msg.x, msg.y, msg.z);
                    op.targetYaw = msg.yaw;
                    op.targetPitch = msg.pitch;
                    
                    // Recreate dynamic name tag only when health actually changes (performance optimized)
                    if (op.health !== msg.health) {
                        op.health = msg.health;
                        if (op.nameTag) {
                            op.mesh.remove(op.nameTag);
                            if (op.nameTag.material) op.nameTag.material.dispose();
                            if (op.nameTag.material.map) op.nameTag.material.map.dispose();
                        }
                        const hexCol = '#' + op.color.toString(16).padStart(6, '0');
                        op.nameTag = createNameTag(op.name, hexCol, op.health);
                        op.nameTag.position.set(0, 2.4, 0);
                        op.mesh.add(op.nameTag);
                    }
                    
                    op.armor = msg.armor;
                    op.score = msg.score;
                }
                break;

            case 'playerShot':
                // Someone else fired their slingshot. Render bullet stone.
                playShoot();
                spawnRemoteProjectile(msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz);
                break;

            case 'dronesUpdate':
                // Sync active drone positions & stats
                msg.drones.forEach(du => {
                    const drone = drones[du.id];
                    if (drone) {
                        drone.targetPos.set(du.x, du.y, du.z);
                        drone.health = du.health;
                        drone.state = du.state;

                        if (drone.health <= 0) {
                            explodeVoxelMesh(drone.mesh.position, 0xff3366, 25);
                            scene.remove(drone.mesh);
                            delete drones[du.id];
                        }
                    }
                });
                break;

            case 'droneShoot':
                // A drone shot an energy blast
                spawnEnergyBlast(msg.x, msg.y, msg.z, msg.targetX, msg.targetY, msg.targetZ);
                break;

            case 'droneDamaged':
                // Damage feedback
                playEnemyHit();
                const dmDrone = drones[msg.droneId];
                if (dmDrone) {
                    dmDrone.health = msg.health;
                    explodeVoxelMesh(dmDrone.mesh.position, 0xff3366, 12);
                    
                    if (dmDrone.health <= 0) {
                        explodeVoxelMesh(dmDrone.mesh.position, 0xff3366, 25); // extra particles for kill
                        scene.remove(dmDrone.mesh);
                        delete drones[msg.droneId];
                    }
                    
                    if (msg.killerId === localPlayerId) {
                        playerScore += 600;
                        updateScoreDisplay();
                    }
                }
                break;

            case 'playerDamaged':
                if (msg.id === localPlayerId) {
                    playerHealth = msg.health;
                    playPlayerHit();
                    triggerPortraitFace('damaged');
                    
                    // Flash screen voxel damage particles on local player hit
                    explodeVoxelMesh(camera.position, 0xff0055, 15);
                    
                    if (playerHealth <= 0) {
                        triggerDeath();
                    }
                } else {
                    const op = otherPlayers[msg.id];
                    if (op) {
                        op.health = msg.health;
                        
                        // Update player name tag and health indicator
                        if (op.nameTag) {
                            op.mesh.remove(op.nameTag);
                            if (op.nameTag.material) op.nameTag.material.dispose();
                            if (op.nameTag.material.map) op.nameTag.material.map.dispose();
                        }
                        const hexCol = '#' + op.color.toString(16).padStart(6, '0');
                        op.nameTag = createNameTag(op.name, hexCol, op.health);
                        op.nameTag.position.set(0, 2.4, 0);
                        op.mesh.add(op.nameTag);

                        // Broadcast red impact voxel particles on the remote hit player for all to see
                        explodeVoxelMesh(op.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff0055, 15);
                    }
                }
                break;

            case 'itemCollected':
                playPickup();
                const item = items[msg.itemId];
                if (item) {
                    scene.remove(item.mesh);
                    item.collected = true;

                    if (msg.pickerId === localPlayerId) {
                        if (msg.itemType === 'health') {
                            playerHealth = Math.min(100, playerHealth + 40);
                            addChatMessage('SUPRIMENTO', '#ff3366', '+40 de Integridade Física recolhido!');
                        } else {
                            playerAmmo = Math.min(maxAmmo, playerAmmo + 5);
                            addChatMessage('SUPRIMENTO', '#ffcc00', '+5 Pedras de Munição recolhidas!');
                        }
                        triggerPortraitFace('idle');
                    }
                }
                break;

            case 'itemRespawned':
                spawnItemMesh(msg);
                break;

            case 'gameOver':
                runActive = false;
                gameStatus = 'won';
                document.exitPointerLock();

                document.getElementById('winner-name').innerText = msg.name;
                document.getElementById('win-score').innerText = msg.score;
                document.getElementById('win-time').innerText = msg.time + 's';

                // Save record
                if (msg.winnerId === localPlayerId) {
                    const currentBest = parseFloat(localStorage.getItem('scape_lab2_best_time'));
                    if (isNaN(currentBest) || msg.time < currentBest) {
                        localStorage.setItem('scape_lab2_best_time', msg.time);
                        bestTime = msg.time + 's';
                        document.getElementById('hud-best-val').innerText = bestTime;
                    }
                }

                winScreen.classList.add('active');
                
                // WIN countdown ticker
                let count = 10;
                const cdEl = document.getElementById('restart-countdown');
                cdEl.innerText = count;
                const interval = setInterval(() => {
                    count--;
                    cdEl.innerText = count;
                    if (count <= 0) clearInterval(interval);
                }, 1000);
                break;

            case 'restartGame':
                // Reset HUD, close all screens & Position
                winScreen.classList.remove('active');
                gameOverScreen.classList.remove('active');
                pauseScreen.classList.remove('active');
                playerHealth = 100;
                playerArmor = 100;
                playerScore = 10000;
                playerAmmo = 10;
                playerPos.set(4.0, 1.2, 4.0);
                camera.position.copy(playerPos);
                yaw = 0;
                pitch = 0;

                speedrunTimer = 0;
                runActive = true;
                gameStatus = 'active';

                // Clear previous game entities
                clear3DEntities();

                // Rebuild Labyrinth
                buildLabyrinth(msg.seed);

                // Re-spawn items & drones
                msg.drones.forEach(d => spawnDroneMesh(d));
                msg.items.forEach(it => spawnItemMesh(it));

                document.body.requestPointerLock();
                break;

            case 'playerRenamed':
                const opName = otherPlayers[msg.id];
                if (opName) {
                    opName.name = msg.name;
                    
                    // Recreate name tag with new name
                    if (opName.nameTag) {
                        opName.mesh.remove(opName.nameTag);
                        if (opName.nameTag.material) opName.nameTag.material.dispose();
                        if (opName.nameTag.material.map) opName.nameTag.material.map.dispose();
                    }
                    const hexCol = '#' + opName.color.toString(16).padStart(6, '0');
                    opName.nameTag = createNameTag(opName.name, hexCol, opName.health);
                    opName.nameTag.position.set(0, 2.4, 0);
                    opName.mesh.add(opName.nameTag);
                }
                break;

            case 'chat':
                addChatMessage(msg.senderName, msg.senderColor, msg.text);
                break;

            case 'highScoresUpdate':
                populateLeaderboard(msg.highScores);
                break;
        }
    };
}

// -------------------------------------------------------------
// LABYRINTH PROCEDURAL CONSTRUCTION
// -------------------------------------------------------------
function buildLabyrinth(seed) {
    mazeGrid = generateMaze(17, 17, seed);

    const wallGeo = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
    
    // Create combined material list to save web drawing overheads
    const materials = {
        ice: new THREE.MeshLambertMaterial({ map: textures.iceWall }),
        forest: new THREE.MeshLambertMaterial({ map: textures.forestWall }),
        desert: new THREE.MeshLambertMaterial({ map: textures.desertWall }),
        bunker: new THREE.MeshLambertMaterial({ map: textures.bunkerWall })
    };

    const floorMats = {
        ice: new THREE.MeshLambertMaterial({ map: textures.iceFloor }),
        forest: new THREE.MeshLambertMaterial({ map: textures.forestFloor }),
        desert: new THREE.MeshLambertMaterial({ map: textures.desertFloor }),
        bunker: new THREE.MeshLambertMaterial({ map: textures.bunkerFloor })
    };

    // Iterate the grid map and build the 3D meshes
    for (let z = 0; z < 17; z++) {
        for (let x = 0; x < 17; x++) {
            const biomeType = getBiomeForCell(z);
            
            if (mazeGrid[z][x] === 1) {
                // Wall cube
                const wallMesh = new THREE.Mesh(wallGeo, materials[biomeType]);
                wallMesh.position.set(x * cellSize, wallHeight / 2, z * cellSize);
                scene.add(wallMesh);
            } else {
                // Floor cube
                const floorGeo = new THREE.BoxGeometry(cellSize, 0.2, cellSize);
                const floorMesh = new THREE.Mesh(floorGeo, floorMats[biomeType]);
                floorMesh.position.set(x * cellSize, -0.1, z * cellSize);
                scene.add(floorMesh);

                // Ceiling cube
                const ceilingGeo = new THREE.BoxGeometry(cellSize, 0.2, cellSize);
                const ceilingMesh = new THREE.Mesh(ceilingGeo, floorMats[biomeType]);
                ceilingMesh.position.set(x * cellSize, wallHeight + 0.1, z * cellSize);
                scene.add(ceilingMesh);
            }
        }
    }

    // Add Escape Gold Portal Mesh at (15, 15) grid cell
    const portalGeo = new THREE.TorusGeometry(1.2, 0.3, 8, 24);
    const portalMat = new THREE.MeshPhysicalMaterial({
        color: 0xffcc00,
        emissive: 0xffaa00,
        emissiveIntensity: 1.0,
        roughness: 0.1,
        metalness: 0.9
    });
    const portalMesh = new THREE.Mesh(portalGeo, portalMat);
    portalMesh.position.set(15 * cellSize, 1.8, 15 * cellSize);
    portalMesh.rotation.y = Math.PI / 4;
    scene.add(portalMesh);

    // Glowing pointlight on exit
    const portalLight = new THREE.PointLight(0xffaa00, 1.5, 8);
    portalLight.position.set(15 * cellSize, 1.8, 15 * cellSize);
    scene.add(portalLight);
}

// Clear all assets for room restarts
function clear3DEntities() {
    // Collect all grid blocks, players, drones and remove them
    const toRemove = [];
    scene.traverse(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.PointLight) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(mesh => scene.remove(mesh));

    otherPlayers = {};
    drones = {};
    items = {};
    stones = [];
}

// -------------------------------------------------------------
// SPAWNING MULTIPLAYER & VOXEL BEHAVIORS
// -------------------------------------------------------------

// Spawn other online players as articulated 3D voxel models
function spawnOtherPlayer(p) {
    const group = new THREE.Group();

    // 1. Torso Voxel (Space Suit)
    const bodyMat = new THREE.MeshLambertMaterial({ color: p.color });
    const voxelBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), bodyMat);
    voxelBody.position.y = 1.2; // Sits above legs ([0.8, 1.6])
    group.add(voxelBody);

    // 2. Head Voxel (Helmet Style)
    const headMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    const voxelHead = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), headMat);
    voxelHead.position.y = 1.825; // Sits above torso ([1.6, 2.05])
    group.add(voxelHead);

    // Face Visor
    const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.1), new THREE.MeshBasicMaterial({ color: 0x00aaff }));
    visorMesh.position.set(0, 0.08, 0.22);
    voxelHead.add(visorMesh);

    // 3. Left Arm (Shoulder pivot, swings when walking)
    const armMat = new THREE.MeshLambertMaterial({ color: p.color });
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16), armMat);
    // Shift geometry downwards by 0.4 to place pivot at shoulder (top of arm)
    armL.geometry.translate(0, -0.4, 0);
    armL.position.set(-0.34, 1.5, 0); // Shoulder at y = 1.5
    group.add(armL);

    // 4. Right Arm (Holds the 3D Slingshot)
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16), armMat);
    armR.geometry.translate(0, -0.4, 0);
    armR.position.set(0.34, 1.5, 0); // Shoulder at y = 1.5
    group.add(armR);

    // 3D Slingshot attached directly to Right Arm (Hand is at y = -0.8 in translated geometry)
    const slingshotGroup = new THREE.Group();
    const handleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), new THREE.MeshLambertMaterial({ color: 0x92400e }));
    handleMesh.position.y = -0.08;
    const forkL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), new THREE.MeshLambertMaterial({ color: 0x92400e }));
    forkL.position.set(-0.06, 0.05, 0.08);
    const forkR = forkL.clone();
    forkR.position.x = 0.06;
    slingshotGroup.add(handleMesh, forkL, forkR);

    slingshotGroup.position.set(0, -0.8, 0.12); // Held in hand
    slingshotGroup.rotation.x = -Math.PI / 4; // ready stance tilt
    armR.add(slingshotGroup);

    // 5. Left Leg (Hip pivot)
    const legMat = new THREE.MeshLambertMaterial({ color: 0x334155 }); // dark trousers
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.18), legMat);
    // Shift geometry downwards by 0.4 to place pivot at hip (top of leg)
    legL.geometry.translate(0, -0.4, 0);
    legL.position.set(-0.15, 0.8, 0); // Hip at y = 0.8
    group.add(legL);

    // 6. Right Leg
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.18), legMat);
    legR.geometry.translate(0, -0.4, 0);
    legR.position.set(0.15, 0.8, 0); // Hip at y = 0.8
    group.add(legR);

    // Position other player directly on the ground floor at y = 0.0
    group.position.set(p.x, 0.0, p.z);
    
    // Create visual name tag and dynamic health indicator above player helmet
    const hexCol = '#' + p.color.toString(16).padStart(6, '0');
    const nameTag = createNameTag(p.name, hexCol, p.health || 100);
    nameTag.position.set(0, 2.4, 0);
    group.add(nameTag);
    
    scene.add(group);

    otherPlayers[p.id] = {
        id: p.id,
        name: p.name,
        color: p.color,
        mesh: group,
        nameTag: nameTag,
        armL: armL,
        armR: armR,
        legL: legL,
        legR: legR,
        targetPos: new THREE.Vector3(p.x, 0.0, p.z),
        targetYaw: p.yaw || 0,
        targetPitch: p.pitch || 0, // Safe default to prevent NaNs
        health: p.health || 100,
        armor: p.armor || 100,
        score: p.score || 10000
    };
}

function removeOtherPlayer(id) {
    const op = otherPlayers[id];
    if (op) {
        scene.remove(op.mesh);
        
        // Clean up Three.js name tag materials/textures to avoid memory leaks
        if (op.nameTag) {
            op.mesh.remove(op.nameTag);
            if (op.nameTag.material) {
                if (op.nameTag.material.map) op.nameTag.material.map.dispose();
                op.nameTag.material.dispose();
            }
        }
        
        addChatMessage('SISTEMA', '#ff3366', `${op.name} desconectou-se da táctica.`);
        delete otherPlayers[id];
    }
}

// Spawn articulated Voxel Drone Mesh
function spawnDroneMesh(d) {
    const group = new THREE.Group();

    // 1. Central Voxel Square Body
    const isBoss = d.type === 'boss';
    const scale = isBoss ? 2.5 : 1.0;
    
    const bodyMat = new THREE.MeshPhysicalMaterial({
        color: isBoss ? 0x0f172a : 0x475569, // dark metal
        metalness: 0.85,
        roughness: 0.15
    });
    const bodyGeo = new THREE.BoxGeometry(0.55 * scale, 0.55 * scale, 0.55 * scale);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(bodyMesh);

    // 2. Corner Voxel Stabilizer Pads (Square sci-fi design instead of wings)
    const padMat = new THREE.MeshLambertMaterial({ color: isBoss ? 0x1e293b : 0x334155 });
    const padGeo = new THREE.BoxGeometry(0.12 * scale, 0.12 * scale, 0.12 * scale);
    
    const padOffsets = [
        [-0.28, 0.28, -0.28],
        [0.28, 0.28, -0.28],
        [-0.28, 0.28, 0.28],
        [0.28, 0.28, 0.28]
    ];
    padOffsets.forEach(([px, py, pz]) => {
        const pad = new THREE.Mesh(padGeo, padMat);
        pad.position.set(px * scale, py * scale, pz * scale);
        group.add(pad);
    });

    // 3. Emissive Red Laser Lens Visor (Front)
    const eyeGeo = new THREE.BoxGeometry(0.3 * scale, 0.12 * scale, 0.1 * scale);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // bright glowing red
    const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
    eyeMesh.position.set(0, 0.05 * scale, 0.25 * scale);
    group.add(eyeMesh);

    // 4. Boss procedural energy antennas
    if (isBoss) {
        const antGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 4);
        const antL = new THREE.Mesh(antGeo, new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
        antL.position.set(-0.2, 0.5, 0);
        antL.rotation.z = -0.3;
        group.add(antL);

        const antR = antL.clone();
        antR.position.x = 0.2;
        antR.rotation.z = 0.3;
        group.add(antR);
    }

    group.position.set(d.x, d.y, d.z);
    scene.add(group);

    drones[d.id] = {
        id: d.id,
        type: d.type,
        mesh: group,
        wingL: null, // wings removed
        wingR: null,
        targetPos: new THREE.Vector3(d.x, d.y, d.z),
        health: d.health,
        state: d.state
    };
}

// Spawn Supplies (Floating Medkits and Ammo Crates)
function spawnItemMesh(it) {
    const group = new THREE.Group();

    let itemMesh;
    if (it.type === 'health') {
        // Red box with white cross texture procedurally generated
        const cubeMat = new THREE.MeshPhysicalMaterial({ color: 0xb91c1c, roughness: 0.1 });
        itemMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), cubeMat);
        
        // Add white cross voxels
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.52), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.52), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        group.add(itemMesh, crossH, crossV);
    } else {
        // Ammo box: Yellow metal with dark stripes
        const ammoMat = new THREE.MeshPhysicalMaterial({ color: 0xf59e0b, roughness: 0.2 });
        itemMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.4), ammoMat);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.42), new THREE.MeshBasicMaterial({ color: 0x1e293b }));
        group.add(itemMesh, stripe);
    }

    group.position.set(it.x, 0.6, it.z);
    scene.add(group);

    items[it.id] = {
        id: it.id,
        type: it.type,
        mesh: group,
        collected: false
    };
}

// -------------------------------------------------------------
// CONTROLS & FPS PHYSICS
// -------------------------------------------------------------
function setupInputListeners() {
    // 1. Mouse movements for Pointer Lock Camera Yaw & Pitch
    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement === document.body && gameStatus === 'active') {
            yaw -= e.movementX * sensitivity;
            pitch -= e.movementY * sensitivity;
            
            // Limit Pitch to avoid flipping over
            pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));
            
            camera.rotation.y = yaw;
            camera.rotation.x = pitch;
        }
    });

    // 2. Keyboard bindings
    const handleKey = (e, val) => {
        if (document.activeElement === chatInput) return; // ignore when typing in chat
        
        switch (e.key.toLowerCase()) {
            case 'w': case 'arrowup': keys.w = val; break;
            case 'a': case 'arrowleft': keys.a = val; break;
            case 's': case 'arrowdown': keys.s = val; break;
            case 'd': case 'arrowright': keys.d = val; break;
        }
    };

    document.addEventListener('keydown', (e) => {
        handleKey(e, true);
        
        // Enter key toggles chat input
        if (e.key === 'Enter') {
            if (document.activeElement === chatInput) {
                sendChatMessage();
            } else {
                chatInput.focus();
            }
        }
    });
    
    document.addEventListener('keyup', (e) => {
        handleKey(e, false);
    });

    // 3. Mouse Click (Stretch and shoot slingshot)
    document.addEventListener('mousedown', (e) => {
        if (document.pointerLockElement !== document.body) return;
        if (gameStatus !== 'active' || playerHealth <= 0) return;

        if (e.button === 0 && slingshotState === 'idle') {
            // Initiate rubber stretch
            slingshotState = 'stretch';
            slingshotStretch = 0.0;
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (document.pointerLockElement !== document.body) return;
        if (gameStatus !== 'active' || playerHealth <= 0) return;

        if (e.button === 0 && slingshotState === 'stretch') {
            // Check Ammo
            if (playerAmmo > 0) {
                playerAmmo--;
                document.getElementById('hud-ammo-val').innerText = playerAmmo;
                
                fireSlingshot();
            } else {
                // Out of ammo: quick snap blank animation
                slingshotState = 'idle';
                triggerPortraitFace('idle');
            }
        }
    });

    // Pointer Lock events to show pause menu
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === document.body) {
            pauseScreen.classList.remove('active');
        } else {
            if (gameStatus === 'active') {
                pauseScreen.classList.add('active');
            }
        }
    });
}

// Fire Slingshot Projection
function fireSlingshot() {
    slingshotState = 'snap';
    slingshotAnimTime = 0.0;

    // Trigger aggressive facial portrait
    triggerPortraitFace('shoot');

    // Create 2D HUD Speedlines
    speedLines = [];
    for (let i = 0; i < 12; i++) {
        speedLines.push({
            angle: Math.random() * Math.PI * 2,
            length: Math.random() * 80 + 40,
            speed: Math.random() * 5 + 5,
            dist: Math.random() * 50 + 20
        });
    }

    // Play procedural snap audio
    playShoot();

    // 3D Camera Ray Aim Vector
    const aimDir = new THREE.Vector3();
    camera.getWorldDirection(aimDir);

    // Initial projectile coordinates (just ahead of player camera)
    const stonePos = playerPos.clone().add(aimDir.clone().multiplyScalar(0.5));

    // Instant Velocity
    const velocityFactor = 28.0; // speed
    const velocity = aimDir.clone().multiplyScalar(velocityFactor);

    // Sync shoot command to the WebSocket Server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'shoot',
            x: stonePos.x,
            y: stonePos.y,
            z: stonePos.z,
            vx: velocity.x,
            vy: velocity.y,
            vz: velocity.z
        }));
    }

    // Launch local projectile for instant visual response
    spawnLocalProjectile(stonePos, velocity);
}

// -------------------------------------------------------------
// PROJECTILES & VOXEL PARTICLES
// -------------------------------------------------------------
function spawnLocalProjectile(pos, velocity) {
    const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);

    stones.push({
        mesh: mesh,
        velocity: velocity,
        spawnTime: performance.now(),
        local: true
    });
}

function spawnRemoteProjectile(x, y, z, vx, vy, vz) {
    const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const mat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    stones.push({
        mesh: mesh,
        velocity: new THREE.Vector3(vx, vy, vz),
        spawnTime: performance.now(),
        local: false
    });
}

// Spawn green plasma burst from drone
function spawnEnergyBlast(x, y, z, tx, ty, tz) {
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x39ff14 }); // glowing toxic green
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    const aim = new THREE.Vector3(tx - x, ty - y, tz - z).normalize();
    const vel = aim.multiplyScalar(14.0); // slower bullet velocity

    stones.push({
        mesh: mesh,
        velocity: vel,
        spawnTime: performance.now(),
        isDroneEnergy: true
    });
}

// Explosions: Voxel particles with physical scatter
function explodeVoxelMesh(pos, colorHex, count) {
    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });

    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        scene.add(mesh);

        // Scatter velocity vectors
        const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 8.0,
            Math.random() * 6.0 + 1.0,
            (Math.random() - 0.5) * 8.0
        );

        particles.push({
            mesh: mesh,
            velocity: vel,
            gravity: 14.0,
            life: 1.0 // decays over seconds
        });
    }
}

// -------------------------------------------------------------
// GAME LOOPS (ANIMATION)
// -------------------------------------------------------------
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1); // cap lag frames
    lastTime = now;

    if (gameStatus === 'active') {
        updateGameplay(delta);
    }

    // Render WebGL
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

// Primary update sequence
function updateGameplay(delta) {
    if (runActive) {
        speedrunTimer += delta;
        document.getElementById('hud-timer-val').innerText = speedrunTimer.toFixed(2) + 's';
        
        // Decay score gradually to incentivize speed
        playerScore = Math.max(100, playerScore - delta * 5.0);
        updateScoreDisplay();
    }

    updatePhysicsMovement(delta);
    updateProjectiles(delta);
    updateVoxelParticles(delta);
    
    // Sync other players animations/interpolation
    updateRemotePlayersInterpolation(delta);

    // Update floating supplies animation
    Object.keys(items).forEach(id => {
        const item = items[id];
        if (item && !item.collected) {
            item.mesh.rotation.y += delta * 1.5;
            item.mesh.position.y = 0.6 + Math.sin(now() * 0.003) * 0.1;
        }
    });

    // Check Medkit/Ammo collisions locally
    checkLocalPickupsCollision();

    // Check Exit Portal win collision
    checkExitPortalCollision();

    // Redraw dynamic HUD graphics (Minimap, Slingshot UI, Commander Portrait)
    drawSlingshotHUD();
    minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    drawMinimap();
    drawCommanderPortrait(delta);
    drawOnlineSquadHUD();
}

function now() { return performance.now(); }

// -------------------------------------------------------------
// INDEPENDENT X/Z SLIDING PHYSICS COLLISION
// -------------------------------------------------------------
function updatePhysicsMovement(delta) {
    if (playerHealth <= 0) return;

    // Camera Direction
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    
    forward.y = 0; forward.normalize();
    right.y = 0; right.normalize();

    // Compute desired move direction
    const moveDir = new THREE.Vector3();
    if (keys.w) moveDir.add(forward);
    if (keys.s) moveDir.sub(forward);
    if (keys.a) moveDir.sub(right);
    if (keys.d) moveDir.add(right);
    moveDir.normalize();

    isMoving = moveDir.lengthSq() > 0;

    // Apply movement speeds
    playerVelocity.copy(moveDir).multiplyScalar(moveSpeed);

    // ---------------------------------------------------------
    // SLIDING COLLISION: Decompose X and Z
    // ---------------------------------------------------------
    const radius = 0.6; // Player bounding cylinder radius
    const originalPos = playerPos.clone();

    // 1. Move along X independently
    playerPos.x += playerVelocity.x * delta;
    if (checkMazeWallCollision(playerPos.x, playerPos.z, radius)) {
        playerPos.x = originalPos.x; // Block X, slide on Z
    }

    // 2. Move along Z independently
    playerPos.z += playerVelocity.z * delta;
    if (checkMazeWallCollision(playerPos.x, playerPos.z, radius)) {
        playerPos.z = originalPos.z; // Block Z, slide on X
    }

    // Camera Bobbing
    if (isMoving) {
        bobTime += delta * 12.0;
        playerPos.y = 1.2 + Math.sin(bobTime) * 0.08;
    } else {
        playerPos.y = 1.2 + Math.sin(now() * 0.002) * 0.02; // soft idle breathe
    }

    camera.position.copy(playerPos);

    // Broadcast updated location to other players via WS
    if (ws && ws.readyState === WebSocket.OPEN && localPlayerId) {
        ws.send(JSON.stringify({
            type: 'update',
            x: playerPos.x,
            y: playerPos.y,
            z: playerPos.z,
            yaw: yaw,
            pitch: pitch,
            health: playerHealth,
            armor: playerArmor,
            score: Math.floor(playerScore)
        }));
    }
}

function checkMazeWallCollision(px, pz, radius) {
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

// -------------------------------------------------------------
// PROJECTILE & PARTICLE UPDATE
// -------------------------------------------------------------
function updateProjectiles(delta) {
    const maxLifeTime = 3000; // 3 seconds flight limit
    const pRadius = 0.15;

    for (let i = stones.length - 1; i >= 0; i--) {
        const stone = stones[i];
        
        // Remove dead stones
        if (performance.now() - stone.spawnTime > maxLifeTime) {
            scene.remove(stone.mesh);
            stones.splice(i, 1);
            continue;
        }

        // Apply constant velocity translation
        stone.mesh.position.addScaledVector(stone.velocity, delta);

        const pos = stone.mesh.position;

        // A. Collision check: Stones hitting Solid Walls
        if (checkMazeWallCollision(pos.x, pos.z, pRadius) || pos.y <= 0.1 || pos.y >= wallHeight - 0.1) {
            // Trigger wall voxel particles
            explodeVoxelMesh(pos, 0x888888, 8);
            scene.remove(stone.mesh);
            stones.splice(i, 1);
            continue;
        }

        // B. Collision check: Local Player Stones hitting Drones or Other Players
        if (stone.local && !stone.isDroneEnergy) {
            let hitRegistered = false;
            
            // Check collisions against Drones
            Object.keys(drones).forEach(dId => {
                if (hitRegistered) return;
                const drone = drones[dId];
                
                const distance = pos.distanceTo(drone.mesh.position);
                const collisionThreshold = drone.type === 'boss' ? 1.5 : 0.6;

                if (distance < collisionThreshold) {
                    // Register hit on server
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'droneHit',
                            droneId: dId,
                            damage: 35 // standard slingshot stone damage
                        }));
                    }
                    
                    hitRegistered = true;
                }
            });

            // Check PVP collisions against other players (cylindrical collision check)
            if (!hitRegistered) {
                Object.keys(otherPlayers).forEach(opId => {
                    if (hitRegistered) return;
                    const op = otherPlayers[opId];
                    if (op.health <= 0) return;

                    const opPos = op.mesh.position; // Grounded y=0 base position
                    const dx = pos.x - opPos.x;
                    const dz = pos.z - opPos.z;
                    const distXZ = Math.sqrt(dx * dx + dz * dz);

                    // Cylindrical check: radius 0.6, height range 0.0 to 2.2
                    if (distXZ < 0.6 && pos.y >= 0.0 && pos.y <= 2.2) {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'pvpHit',
                                targetId: opId,
                                damage: 25 // standard slingshot stone damage against players
                            }));
                        }
                        
                        // Local instant hit feedback
                        playEnemyHit();
                        explodeVoxelMesh(pos, 0xff0055, 12); // red impact particles
                        hitRegistered = true;
                    }
                });
            }

            if (hitRegistered) {
                scene.remove(stone.mesh);
                stones.splice(i, 1);
                continue;
            }
        }

        // C. Collision check: Drone Energy Blasts hitting the Local Player
        if (stone.isDroneEnergy) {
            const distToPlayer = pos.distanceTo(playerPos);
            if (distToPlayer < 0.8 && playerHealth > 0) {
                // Hurt player
                const dmg = 15;
                playerHealth = Math.max(0, playerHealth - dmg);
                playPlayerHit();
                triggerPortraitFace('damaged');

                // Notify Server
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'playerHit',
                        damage: dmg
                    }));
                }

                if (playerHealth <= 0) {
                    triggerDeath();
                }

                scene.remove(stone.mesh);
                stones.splice(i, 1);
            }
        }
    }
}

// Update particle animations (physics and visual fadeout)
function updateVoxelParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        
        p.life -= delta * 1.5; // decay life
        
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
            continue;
        }

        // Physics velocity
        p.velocity.y -= p.gravity * delta; // gravity pull
        p.mesh.position.addScaledVector(p.velocity, delta);

        // Shrink voxels based on decay
        p.mesh.scale.setScalar(p.life);
    }
}

// Smoothly interpolate other players' coordinate locations and animate walking limbs
function updateRemotePlayersInterpolation(delta) {
    Object.keys(otherPlayers).forEach(id => {
        const op = otherPlayers[id];
        
        // Grounded position interpolation (forces other players to stay on the floor y = 0.0)
        const targetGroundPos = op.targetPos.clone();
        targetGroundPos.y = 0.0;
        op.mesh.position.lerp(targetGroundPos, delta * 15.0);
        
        // Rotations (Yaw)
        op.mesh.rotation.y = THREE.MathUtils.lerp(op.mesh.rotation.y, op.targetYaw, delta * 15.0);
        
        // Interpolate body parts (Head Pitch with strict NaN safety checks)
        const voxelHead = op.mesh.children[1];
        if (voxelHead) {
            const safePitch = isNaN(op.targetPitch) || op.targetPitch === undefined ? 0 : op.targetPitch;
            voxelHead.rotation.x = THREE.MathUtils.lerp(voxelHead.rotation.x, safePitch, delta * 15.0);
        }

        // Check movement speed to determine if other player is walking
        const isOpMoving = op.mesh.position.distanceTo(op.targetPos) > 0.03;
        
        if (isOpMoving && op.legL && op.legR && op.armL && op.armR) {
            // Alternating legs and arms swings (Minecraft style)
            const speedScale = 0.015;
            const swing = Math.sin(now() * speedScale) * 0.5;
            
            op.legL.rotation.x = swing;
            op.legR.rotation.x = -swing;
            
            op.armL.rotation.x = -swing;
            op.armR.rotation.x = swing - Math.PI / 4; // ready slingshot stance tilt
        } else {
            // Smoothly stand standing straight
            if (op.legL) op.legL.rotation.x = THREE.MathUtils.lerp(op.legL.rotation.x, 0, delta * 10.0);
            if (op.legR) op.legR.rotation.x = THREE.MathUtils.lerp(op.legR.rotation.x, 0, delta * 10.0);
            if (op.armL) op.armL.rotation.x = THREE.MathUtils.lerp(op.armL.rotation.x, 0, delta * 10.0);
            if (op.armR) op.armR.rotation.x = THREE.MathUtils.lerp(op.armR.rotation.x, -Math.PI / 4, delta * 10.0);
        }
    });

    // Interpolate & Animate Drone visual wings/propellers flapping
    Object.keys(drones).forEach(id => {
        const d = drones[id];
        d.mesh.position.lerp(d.targetPos, delta * 10.0);

        // Flapping wings animation
        if (d.wingL && d.wingR) {
            const flapSpeed = d.state === 'chase' ? 30.0 : 15.0;
            const angle = Math.sin(now() * 0.001 * flapSpeed) * 0.4;
            d.wingL.rotation.z = angle;
            d.wingR.rotation.z = -angle;
        }
    });
}

// Collect medkit and ammo
function checkLocalPickupsCollision() {
    if (playerHealth <= 0) return;

    Object.keys(items).forEach(id => {
        const item = items[id];
        if (item.collected) return;

        const distance = playerPos.distanceTo(item.mesh.position);
        if (distance < 1.0) {
            // Picked up! Send socket event
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'pickup',
                    itemId: id
                }));
            }
        }
    });
}

// Exit Portal victory collision check
function checkExitPortalCollision() {
    if (!runActive || playerHealth <= 0) return;

    const portalPos = new THREE.Vector3(15 * cellSize, playerPos.y, 15 * cellSize);
    const distance = playerPos.distanceTo(portalPos);

    if (distance < 1.3) {
        // Escaped! Trigger Win
        runActive = false;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'win',
                time: parseFloat(speedrunTimer.toFixed(2))
            }));
        }
    }
}

// Local Player Defeat logic
function triggerDeath() {
    runActive = false;
    gameStatus = 'gameover';
    triggerPortraitFace('dead');
    document.exitPointerLock();
    
    // Populates death stats
    document.getElementById('death-score').innerText = Math.floor(playerScore);
    document.getElementById('death-time').innerText = speedrunTimer.toFixed(2) + 's';
    
    // Reveal Game Over screen overlay
    gameOverScreen.classList.add('active');
    
    addChatMessage('SISTEMA', '#ff3366', 'Foste eliminado pelo labirinto do Scape Runner!');
}

// Respawn local player on same maze, retaining speedrun timer
function respawnPlayer() {
    gameOverScreen.classList.remove('active');
    
    // Restore health & armors
    playerHealth = 100;
    playerArmor = 100;
    playerAmmo = 10;
    document.getElementById('hud-ammo-val').innerText = playerAmmo;
    
    // Set position back to starting safe cell (1, 1)
    playerPos.set(4.0, 1.2, 4.0);
    camera.position.copy(playerPos);
    yaw = 0;
    pitch = 0;
    
    // Resume ticking timer
    runActive = true;
    gameStatus = 'active';
    triggerPortraitFace('idle');
    
    // Focus capture mouse
    document.body.requestPointerLock();
    
    // Send immediate sync update to other client players
    if (ws && ws.readyState === WebSocket.OPEN && localPlayerId) {
        ws.send(JSON.stringify({
            type: 'update',
            x: playerPos.x,
            y: playerPos.y,
            z: playerPos.z,
            yaw: yaw,
            pitch: pitch,
            health: playerHealth,
            armor: playerArmor,
            score: Math.floor(playerScore)
        }));
    }

    addChatMessage('SOBREVIVÊNCIA', '#00ffaa', 'Reanimado! A corrida continua (tempo acumulado mantido)!');
}

// -------------------------------------------------------------
// 2D CANVAS GRAPHIC HUD DRAWING PROCEDURES
// -------------------------------------------------------------

// Draw the slingshot in pixelated HUD overlays
function drawSlingshotHUD() {
    slingshotCtx.clearRect(0, 0, slingshotCanvas.width, slingshotCanvas.height);

    const w = slingshotCanvas.width;
    const h = slingshotCanvas.height;

    // Define pixel scales
    const pixelSize = Math.max(3, Math.floor(w / 120));

    // Handle slingshot states transitions
    let pullBackX = 0;
    let pullBackY = 0;

    if (slingshotState === 'stretch') {
        slingshotStretch = Math.min(1.0, slingshotStretch + 0.05);
        pullBackY = slingshotStretch * 60;
    } else if (slingshotState === 'snap') {
        slingshotAnimTime += 0.25;
        if (slingshotAnimTime >= 1.0) {
            slingshotState = 'recover';
            slingshotAnimTime = 0.0;
        }
        // snap forward
        pullBackY = -20 * (1 - slingshotAnimTime);
    } else if (slingshotState === 'recover') {
        slingshotAnimTime += 0.08;
        if (slingshotAnimTime >= 1.0) {
            slingshotState = 'idle';
            slingshotStretch = 0;
        }
        // bounce back to center
        pullBackY = -20 * (1 - slingshotAnimTime);
    }

    const centerX = w / 2;
    const centerY = h - 60;

    slingshotCtx.imageSmoothingEnabled = false;

    // 1. Draw rubber bands
    slingshotCtx.strokeStyle = '#ea580c'; // elastic orange-600
    slingshotCtx.lineWidth = pixelSize * 1.5;
    slingshotCtx.lineCap = 'round';

    const forkLX = centerX - 40;
    const forkLY = centerY - 100;
    const forkRX = centerX + 40;
    const forkRY = centerY - 100;

    const pouchX = centerX + pullBackX;
    const pouchY = centerY - 30 + pullBackY;

    // Draw elastic bands connecting pouch to wood forks
    slingshotCtx.beginPath();
    slingshotCtx.moveTo(forkLX, forkLY);
    slingshotCtx.lineTo(pouchX, pouchY);
    slingshotCtx.moveTo(forkRX, forkRY);
    slingshotCtx.lineTo(pouchX, pouchY);
    slingshotCtx.stroke();

    // 2. Draw slingshot wood frame in pixelated boxes
    // Draw Left Fork
    slingshotCtx.fillStyle = '#92400e'; // brown-800
    slingshotCtx.fillRect(forkLX - 5, forkLY, 10, 80);
    // Draw Right Fork
    slingshotCtx.fillRect(forkRX - 5, forkRY, 10, 80);
    // Draw connection bar & Handle
    slingshotCtx.fillRect(forkLX - 5, centerY - 25, 90, 15);
    slingshotCtx.fillRect(centerX - 10, centerY - 25, 20, 95);

    // 3. Draw Leather Pouch
    slingshotCtx.fillStyle = '#451a03'; // dark brown-950
    slingshotCtx.fillRect(pouchX - 16, pouchY - 8, 32, 16);

    // 4. Draw Stone inside Pouch (only when ready/stretching)
    if (playerAmmo > 0 && slingshotState !== 'snap' && slingshotState !== 'recover') {
        slingshotCtx.fillStyle = '#78716c'; // grey-500 stone
        slingshotCtx.fillRect(pouchX - 8, pouchY - 8, 16, 16);
    }

    // 5. Draw 2D speed lines overlay for snappy kicks
    if (slingshotState === 'snap') {
        slingshotCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        slingshotCtx.lineWidth = 2;
        speedLines.forEach(line => {
            line.dist += line.speed;
            const lx = centerX + Math.cos(line.angle) * line.dist;
            const ly = (centerY - 100) + Math.sin(line.angle) * line.dist;
            const endX = lx + Math.cos(line.angle) * line.length;
            const endY = ly + Math.sin(line.angle) * line.length;

            slingshotCtx.beginPath();
            slingshotCtx.moveTo(lx, ly);
            slingshotCtx.lineTo(endX, endY);
            slingshotCtx.stroke();
        });
    }
}

// Draw top-right 2D minimap
function drawMinimap() {
    minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);

    const size = 128;
    const gridBlockSize = size / 17;

    // Draw solid walls
    minimapCtx.fillStyle = 'rgba(0, 229, 255, 0.15)';
    for (let z = 0; z < 17; z++) {
        for (let x = 0; x < 17; x++) {
            if (mazeGrid[z] && mazeGrid[z][x] === 1) {
                minimapCtx.fillRect(x * gridBlockSize, z * gridBlockSize, gridBlockSize - 0.5, gridBlockSize - 0.5);
            }
        }
    }

    // Draw escape portal as blinking gold
    const isGoldBlink = Math.floor(now() / 250) % 2 === 0;
    if (isGoldBlink) {
        minimapCtx.fillStyle = '#ffcc00';
        minimapCtx.beginPath();
        minimapCtx.arc(15 * gridBlockSize + gridBlockSize/2, 15 * gridBlockSize + gridBlockSize/2, gridBlockSize * 0.7, 0, Math.PI*2);
        minimapCtx.fill();
    }

    // Draw Active Drones
    minimapCtx.fillStyle = '#ff3366';
    Object.keys(drones).forEach(dId => {
        const drone = drones[dId];
        const dx = (drone.mesh.position.x / cellSize) * gridBlockSize;
        const dz = (drone.mesh.position.z / cellSize) * gridBlockSize;
        minimapCtx.fillRect(dx - 2, dz - 2, 4, 4);
    });

    // Draw Local Player blue arrow
    const px = (playerPos.x / cellSize) * gridBlockSize;
    const pz = (playerPos.z / cellSize) * gridBlockSize;

    minimapCtx.fillStyle = '#00aaff';
    minimapCtx.save();
    minimapCtx.translate(px, pz);
    minimapCtx.rotate(yaw); // rot matches yaw heading

    minimapCtx.beginPath();
    minimapCtx.moveTo(0, -6);
    minimapCtx.lineTo(-4, 4);
    minimapCtx.lineTo(4, 4);
    minimapCtx.closePath();
    minimapCtx.fill();
    minimapCtx.restore();
}

// 2D Canvas dynamic pixel-art Commander Voxel Portrait
function drawCommanderPortrait(delta) {
    portraitCtx.clearRect(0, 0, 80, 80);
    portraitCtx.imageSmoothingEnabled = false;

    // Frame timer updates
    portraitAnimTimer += delta;

    // State decays to idle
    if (portraitState === 'shoot' && portraitAnimTimer > 0.4) {
        triggerPortraitFace('idle');
    } else if (portraitState === 'damaged' && portraitAnimTimer > 0.6) {
        triggerPortraitFace('idle');
    }

    const center = 40;
    const pSize = 4; // pixel art size

    // Adjust facial colors based on health/damage state
    let faceColor = '#cbd5e1'; // healthy grey-300
    let visorColor = '#00aaff'; // neon blue visor
    let mouthColor = '#0f172a'; // dark slate
    let hasTeethGrid = false;

    if (playerHealth <= 30) {
        faceColor = '#94a3b8'; // sickly shaded
    }

    if (portraitState === 'shoot') {
        mouthColor = '#ff3366'; // red grit
        hasTeethGrid = true;
    } else if (portraitState === 'damaged') {
        faceColor = '#ef4444'; // damaged flush red
        visorColor = '#fbbf24'; // blinking visor warning
    } else if (playerHealth <= 0) {
        faceColor = '#475569'; // dead slate-600
        visorColor = '#334155'; // visor shut off
        mouthColor = '#0f172a';
    }

    // Look direction variations (idle animations looking left/right)
    if (playerHealth > 0 && portraitState === 'idle' && Math.floor(now() / 2000) % 2 === 0) {
        portraitLookAngle = Math.sin(now() * 0.002) * 6; // slow look
    } else {
        portraitLookAngle = 0;
    }

    // 1. Draw head voxel box
    portraitCtx.fillStyle = faceColor;
    portraitCtx.fillRect(center - 18, center - 18, 36, 36);

    // 2. Visor (Eye sensor)
    portraitCtx.fillStyle = visorColor;
    portraitCtx.fillRect(center - 12 + portraitLookAngle, center - 10, 24, 8);
    // Visor reflections
    if (playerHealth > 0) {
        portraitCtx.fillStyle = '#ffffff';
        portraitCtx.fillRect(center - 10 + portraitLookAngle, center - 10, 4, 3);
    }

    // 3. Mouth
    portraitCtx.fillStyle = mouthColor;
    if (hasTeethGrid) {
        portraitCtx.fillRect(center - 8, center + 8, 16, 6);
        // teeth horizontal line
        portraitCtx.fillStyle = '#ffffff';
        portraitCtx.fillRect(center - 6, center + 10, 12, 2);
    } else if (playerHealth <= 0) {
        // Draw standard flat dead mouth line
        portraitCtx.fillRect(center - 6, center + 10, 12, 2);
    } else {
        // Standard small talking box
        const idleTalkHeight = Math.sin(now() * 0.01) > 0.8 ? 4 : 2;
        portraitCtx.fillRect(center - 4 + portraitLookAngle/2, center + 10, 8, idleTalkHeight);
    }

    // 4. Blood / Scratches overlays (only when heavily damaged)
    if (playerHealth <= 50 && playerHealth > 0) {
        portraitCtx.fillStyle = 'rgba(185, 28, 28, 0.85)'; // blood red
        portraitCtx.fillRect(center - 16, center - 12, 4, 16);
        portraitCtx.fillRect(center + 12, center + 4, 4, 8);
        portraitCtx.fillRect(center - 6, center - 16, 8, 4);
    }
}

function triggerPortraitFace(state) {
    portraitState = state;
    portraitAnimTimer = 0.0;
}

// -------------------------------------------------------------
// CHAT & SCOREBOARD MULTIPLAYER PANEL UI
// -------------------------------------------------------------

function sendChatMessage() {
    const text = chatInput.value.trim();
    chatInput.value = '';
    chatInput.blur(); // focus back to canvas

    if (text === '') return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'chat',
            text: text
        }));
    }
}

function addChatMessage(sender, colorHex, text) {
    const p = document.createElement('p');
    p.innerHTML = `<span style="color: ${colorHex}; font-weight: bold;">[${sender}]</span>: ${text}`;
    
    chatMessages.appendChild(p);
    chatMessages.scrollTop = chatMessages.scrollHeight; // auto scroll down
}

// Escapes special characters to prevent HTML/XSS injection
function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Populates the home screen Top 10 High Scores table
function populateLeaderboard(highScoresList) {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (!highScoresList || highScoresList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="color: #64748b; padding: 20px;">SEM REGISTOS</td></tr>';
        return;
    }
    
    highScoresList.forEach((entry, index) => {
        const tr = document.createElement('tr');
        const pos = index + 1;
        
        // Pódio styles
        if (pos === 1) tr.classList.add('top-1');
        else if (pos === 2) tr.classList.add('top-2');
        else if (pos === 3) tr.classList.add('top-3');
        
        tr.innerHTML = `
            <td>#${pos}</td>
            <td style="text-align: left; padding-left: 15px;">${escapeHtml(entry.name)}</td>
            <td>${Math.floor(entry.score)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Generates dynamic 2D canvas based player nametags and health indicators floting in 3D
function createNameTag(name, colorHex, health = 100) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    
    // Glassmorphic panel background
    ctx.fillStyle = 'rgba(10, 14, 23, 0.8)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, 256, 80, 10) : ctx.rect(0, 0, 256, 80);
    ctx.fill();
    
    // Border colored after player sensory suit
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Player Name in bold retro-cyberpunk typography
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, 128, 30);
    
    // Dynamic health bar
    const barWidth = 180;
    const barHeight = 8;
    const barX = 128 - barWidth / 2;
    const barY = 52;
    
    // Empty background
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // Active fill with custom HP colors
    const hpPercent = Math.max(0, Math.min(100, health)) / 100;
    ctx.fillStyle = hpPercent > 0.5 ? '#10b981' : (hpPercent > 0.25 ? '#f59e0b' : '#ef4444');
    ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    
    sprite.scale.set(2.0, 0.625, 1.0);
    return sprite;
}

function drawOnlineSquadHUD() {
    playerList.innerHTML = '';
    
    // Draw local player listing
    const liLocal = document.createElement('li');
    liLocal.innerHTML = `<span style="color: #00aaff;">⬤ ${playerName} (Você)</span> <span class="player-score-tag">${Math.floor(playerScore)} PTS</span>`;
    playerList.appendChild(liLocal);

    // Draw other remote players listing
    Object.keys(otherPlayers).forEach(id => {
        const op = otherPlayers[id];
        const li = document.createElement('li');
        const colStr = '#' + op.color.toString(16).padStart(6, '0');
        li.innerHTML = `<span style="color: ${colStr}">⬤ ${op.name}</span> <span class="player-score-tag">${op.score} PTS</span>`;
        playerList.appendChild(li);
    });
}

function updateScoreDisplay() {
    document.getElementById('hud-score-val').innerText = Math.floor(playerScore);
}

// Direct stats updates on local health/armor
setInterval(() => {
    if (gameStatus !== 'active' || playerHealth <= 0) return;

    // Display values
    document.getElementById('hud-health-val').innerText = Math.floor(playerHealth) + '%';
    document.getElementById('hud-health-bar').style.width = Math.floor(playerHealth) + '%';
    
    document.getElementById('hud-armor-val').innerText = Math.floor(playerArmor) + '%';
    document.getElementById('hud-armor-bar').style.width = Math.floor(playerArmor) + '%';
}, 100);

document.getElementById('hud-best-val').innerText = bestTime;
