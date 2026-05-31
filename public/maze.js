// Labyrinth Maze Generator using Seed-based DFS (Depth-First Search)

// Deterministic seed-based pseudorandom generator
export function createPRNG(seed) {
    let state = seed;
    return function() {
        // Simple trigonometric PRNG
        let x = Math.sin(state++) * 10000;
        return x - Math.floor(x);
    };
}

export function generateMaze(width = 17, height = 17, seed = 12345) {
    const grid = Array(height).fill(null).map(() => Array(width).fill(1)); // 1 = wall, 0 = empty path
    const random = createPRNG(seed);

    // Carve DFS pathways
    const stack = [];
    grid[1][1] = 0; // Spawn cell
    stack.push([1, 1]);

    while (stack.length > 0) {
        const [cx, cz] = stack[stack.length - 1];
        const neighbors = [];

        // DFS steps by 2 units
        const dirs = [
            [0, -2], [0, 2], [-2, 0], [2, 0]
        ];

        for (const [dx, dz] of dirs) {
            const nx = cx + dx;
            const nz = cz + dz;

            if (nx > 0 && nx < width - 1 && nz > 0 && nz < height - 1) {
                if (grid[nz][nx] === 1) {
                    neighbors.push([nx, nz, dx, dz]);
                }
            }
        }

        if (neighbors.length > 0) {
            // Pick a deterministic neighbor
            const idx = Math.floor(random() * neighbors.length);
            const [nx, nz, dx, dz] = neighbors[idx];

            // Carve intermediate wall and target cell
            grid[cz + dz / 2][cx + dx / 2] = 0;
            grid[nz][nx] = 0;

            stack.push([nx, nz]);
        } else {
            stack.pop();
        }
    }

    // Open up ~12% of inner walls to create combat arenas and remove pure dead ends
    for (let z = 1; z < height - 1; z++) {
        for (let x = 1; x < width - 1; x++) {
            if (grid[z][x] === 1) {
                if (random() < 0.12) {
                    grid[z][x] = 0;
                }
            }
        }
    }

    // Explicitly guarantee spawn (1, 1) and escape portal (width - 2, height - 2) are open
    grid[1][1] = 0;
    grid[height - 2][width - 2] = 0;

    return grid;
}

// Map grid coordinates to Biome Sectors
// Sector 1 (Gelo): Rows 0 - 4
// Bunker transition: Row 5
// Sector 2 (Forest): Rows 6 - 10
// Bunker transition: Row 11
// Sector 3 (Desert): Rows 12 - 16
export function getBiomeForCell(z) {
    if (z === 5 || z === 11) {
        return 'bunker';
    } else if (z < 5) {
        return 'ice';
    } else if (z > 11) {
        return 'desert';
    } else {
        return 'forest';
    }
}
