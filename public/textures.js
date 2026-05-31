// Procedural Texture Generator (16x16 Pixel Art)

// Helper: Create a CanvasTexture from a drawing callback
function createVoxelTexture(drawCallback) {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    
    drawCallback(ctx);
    
    // Create THREE CanvasTexture
    const texture = new THREE.CanvasTexture(canvas);
    
    // CRITICAL: Set Nearest filtering for pixelated retro aesthetic
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    
    return texture;
}

// Generate the complete texture atlas/object
export function generateTextures() {
    const textures = {};

    // Helper: Deterministic PRNG for pixel art reproducibility
    function prng(seed) {
        let s = seed;
        return function() {
            let x = Math.sin(s++) * 10000;
            return x - Math.floor(x);
        };
    }

    // 1. Sector 1 (Gelo): Bricks of blue-grey topped with pure snow
    textures.iceWall = createVoxelTexture((ctx) => {
        const rand = prng(101);
        // Base blue-grey slate
        ctx.fillStyle = '#4a5568'; // tailwind slate-600
        ctx.fillRect(0, 0, 16, 16);

        // Pixel noise
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (rand() < 0.2) {
                    ctx.fillStyle = rand() < 0.5 ? '#334155' : '#64748b';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }

        // Draw horizontal/vertical brick lines
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 7, 16, 1);
        ctx.fillRect(0, 15, 16, 1);
        ctx.fillRect(7, 0, 1, 7);
        ctx.fillRect(11, 8, 1, 7);

        // Snow Cap overlay: pure white snow capping top rows
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 16, 2);
        ctx.fillStyle = '#e2e8f0'; // slightly shaded snow
        ctx.fillRect(1, 2, 3, 1);
        ctx.fillRect(6, 2, 4, 1);
        ctx.fillRect(12, 2, 2, 1);
        ctx.fillRect(0, 7, 3, 1); // small frost on brick ledge
        ctx.fillRect(9, 7, 2, 1);
    });

    // 2. Sector 1 Floor (Neve)
    textures.iceFloor = createVoxelTexture((ctx) => {
        const rand = prng(202);
        ctx.fillStyle = '#f8fafc'; // Pure white snow
        ctx.fillRect(0, 0, 16, 16);

        // Shaded ice/snow specs
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (rand() < 0.15) {
                    ctx.fillStyle = rand() < 0.5 ? '#e2e8f0' : '#cbd5e1';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
    });

    // 3. Sector 2 (Ardenas - Floresta): Mossy stone bricks with green leaves
    textures.forestWall = createVoxelTexture((ctx) => {
        const rand = prng(303);
        // Base dark stone grey
        ctx.fillStyle = '#3f3f46'; // zinc-700
        ctx.fillRect(0, 0, 16, 16);

        // Stone pixel noise
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (rand() < 0.15) {
                    ctx.fillStyle = rand() < 0.5 ? '#27272a' : '#52525b';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }

        // Brick mortar lines
        ctx.fillStyle = '#18181b';
        ctx.fillRect(0, 7, 16, 1);
        ctx.fillRect(0, 15, 16, 1);
        ctx.fillRect(5, 0, 1, 7);
        ctx.fillRect(13, 8, 1, 7);

        // Green Moss overlays
        ctx.fillStyle = '#3f6212'; // dark lime-800
        ctx.fillRect(1, 1, 3, 2);
        ctx.fillRect(8, 3, 4, 2);
        ctx.fillRect(2, 9, 3, 3);
        ctx.fillRect(10, 10, 4, 2);

        // Light Green leaves/vines details
        ctx.fillStyle = '#65a30d'; // lime-600
        ctx.fillRect(2, 1, 1, 1);
        ctx.fillRect(9, 4, 1, 1);
        ctx.fillRect(3, 10, 1, 1);
        ctx.fillRect(12, 11, 1, 1);
    });

    // 4. Sector 2 Floor (Relva)
    textures.forestFloor = createVoxelTexture((ctx) => {
        const rand = prng(404);
        ctx.fillStyle = '#15803d'; // Rich forest green (green-700)
        ctx.fillRect(0, 0, 16, 16);

        // Grass blades / light green specs
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const r = rand();
                if (r < 0.2) {
                    ctx.fillStyle = '#22c55e'; // green-500
                    ctx.fillRect(x, y, 1, 1);
                } else if (r < 0.35) {
                    ctx.fillStyle = '#166534'; // green-800
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
    });

    // 5. Sector 3 (Deserto): Golden sandstones
    textures.desertWall = createVoxelTexture((ctx) => {
        const rand = prng(505);
        ctx.fillStyle = '#d97706'; // amber-600 base
        ctx.fillRect(0, 0, 16, 16);

        // Sandstone horizontal strata bands
        ctx.fillStyle = '#b45309'; // amber-700
        ctx.fillRect(0, 4, 16, 3);
        ctx.fillStyle = '#f59e0b'; // amber-500
        ctx.fillRect(0, 10, 16, 2);

        // Noise
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (rand() < 0.25) {
                    ctx.fillStyle = rand() < 0.5 ? '#78350f' : '#fbbf24';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }

        // Brick outlines
        ctx.fillStyle = '#451a03';
        ctx.fillRect(0, 7, 16, 1);
        ctx.fillRect(0, 15, 16, 1);
        ctx.fillRect(3, 0, 1, 7);
        ctx.fillRect(11, 8, 1, 7);
    });

    // 6. Sector 3 Floor (Areia)
    textures.desertFloor = createVoxelTexture((ctx) => {
        const rand = prng(606);
        ctx.fillStyle = '#f59e0b'; // Sandy amber yellow
        ctx.fillRect(0, 0, 16, 16);

        // Sand noise
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (rand() < 0.2) {
                    ctx.fillStyle = '#d97706';
                    ctx.fillRect(x, y, 1, 1);
                } else if (rand() < 0.3) {
                    ctx.fillStyle = '#fbbf24';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }

        // Dune waves (wavy horizontal ripples)
        ctx.fillStyle = '#b45309';
        ctx.fillRect(1, 3, 3, 1);
        ctx.fillRect(4, 4, 4, 1);
        ctx.fillRect(8, 3, 3, 1);
        ctx.fillRect(11, 2, 4, 1);

        ctx.fillRect(0, 11, 4, 1);
        ctx.fillRect(4, 12, 3, 1);
        ctx.fillRect(7, 11, 4, 1);
        ctx.fillRect(11, 10, 5, 1);
    });

    // 7. Bunkers / Connectors: Metal plates with rivets
    textures.bunkerWall = createVoxelTexture((ctx) => {
        const rand = prng(707);
        ctx.fillStyle = '#6b7280'; // grey-500 metal plate
        ctx.fillRect(0, 0, 16, 16);

        // Metallic noise
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (rand() < 0.15) {
                    ctx.fillStyle = rand() < 0.5 ? '#4b5563' : '#9ca3af';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }

        // Inner frame bevel
        ctx.strokeStyle = '#374151'; // dark grey border
        ctx.lineWidth = 1;
        ctx.strokeRect(1.5, 1.5, 13, 13);
        
        ctx.strokeStyle = '#d1d5db'; // light steel highlight
        ctx.strokeRect(0.5, 0.5, 15, 15);

        // Corner Rivets at (2,2), (13,2), (2,13), (13,13)
        const rivetCoords = [[2,2], [13,2], [2,13], [13,13]];
        rivetCoords.forEach(([rx, ry]) => {
            ctx.fillStyle = '#111827'; // Rivet dark socket
            ctx.fillRect(rx, ry, 1, 1);
            ctx.fillStyle = '#e5e7eb'; // Rivet highlight head
            ctx.fillRect(rx + 1, ry + 1, 1, 1);
        });
    });

    // 8. Bunker Floor (Betão antiderrapante)
    textures.bunkerFloor = createVoxelTexture((ctx) => {
        const rand = prng(808);
        ctx.fillStyle = '#4b5563'; // concrete grey-600
        ctx.fillRect(0, 0, 16, 16);

        // Concrete grain noise
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (rand() < 0.25) {
                    ctx.fillStyle = rand() < 0.5 ? '#374151' : '#6b7280';
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }

        // Non-slip checkered pattern: dark diagonal tick lines
        ctx.fillStyle = '#1f2937';
        for (let i = 0; i < 16; i += 4) {
            ctx.fillRect(i, i, 2, 2);
            ctx.fillRect(14 - i, i, 2, 2);
        }
    });

    return textures;
}
