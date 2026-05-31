// Web Audio API Retro Sound Effects Synthesizer

let audioCtx = null;

// Initialize Audio Context on first user gesture
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Helper to generate a short burst of white noise
function createNoiseBuffer() {
    const bufferSize = audioCtx.sampleRate * 0.4; // 0.4 seconds
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

// 1. Shoot Sound (Thwip): White noise bandpass + descending sawtooth
export function playShoot() {
    try {
        initAudio();
        if (!audioCtx) return;

        const time = audioCtx.currentTime;

        // Sawtooth wave for the snap projection
        const osc = audioCtx.createOscillator();
        const gainOsc = audioCtx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, time);
        osc.frequency.exponentialRampToValueAtTime(80, time + 0.15);
        
        gainOsc.gain.setValueAtTime(0.3, time);
        gainOsc.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

        osc.connect(gainOsc);
        gainOsc.connect(audioCtx.destination);
        osc.start(time);
        osc.stop(time + 0.15);

        // White Noise with Bandpass for the rubber elastic release friction
        const noise = audioCtx.createBufferSource();
        noise.buffer = createNoiseBuffer();

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1000, time);
        filter.frequency.exponentialRampToValueAtTime(150, time + 0.1);

        const gainNoise = audioCtx.createGain();
        gainNoise.gain.setValueAtTime(0.4, time);
        gainNoise.gain.exponentialRampToValueAtTime(0.01, time + 0.12);

        noise.connect(filter);
        filter.connect(gainNoise);
        gainNoise.connect(audioCtx.destination);

        noise.start(time);
        noise.stop(time + 0.12);
    } catch (e) {
        console.warn('Som não pôde ser sintetizado:', e);
    }
}

// 2. Enemy Hit Sound (Voxel Metallic Clang): Short noise + high frequency sine wave
export function playEnemyHit() {
    try {
        initAudio();
        if (!audioCtx) return;

        const time = audioCtx.currentTime;

        // High metallic chime
        const osc = audioCtx.createOscillator();
        const gainOsc = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, time);
        osc.frequency.exponentialRampToValueAtTime(1200, time + 0.08);
        
        gainOsc.gain.setValueAtTime(0.25, time);
        gainOsc.gain.exponentialRampToValueAtTime(0.01, time + 0.08);

        osc.connect(gainOsc);
        gainOsc.connect(audioCtx.destination);
        osc.start(time);
        osc.stop(time + 0.08);

        // High frequency noise blast
        const noise = audioCtx.createBufferSource();
        noise.buffer = createNoiseBuffer();

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(2000, time);

        const gainNoise = audioCtx.createGain();
        gainNoise.gain.setValueAtTime(0.3, time);
        gainNoise.gain.exponentialRampToValueAtTime(0.01, time + 0.06);

        noise.connect(filter);
        filter.connect(gainNoise);
        gainNoise.connect(audioCtx.destination);

        noise.start(time);
        noise.stop(time + 0.06);
    } catch (e) {
        console.warn('Som não pôde ser sintetizado:', e);
    }
}

// 3. Player Hit Sound (Player Damage): Heavy grave pitch slide descending sawtooth
export function playPlayerHit() {
    try {
        initAudio();
        if (!audioCtx) return;

        const time = audioCtx.currentTime;

        const osc = audioCtx.createOscillator();
        const gainOsc = audioCtx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, time);
        osc.frequency.linearRampToValueAtTime(50, time + 0.25);
        
        gainOsc.gain.setValueAtTime(0.4, time);
        gainOsc.gain.exponentialRampToValueAtTime(0.01, time + 0.25);

        // Add a lowpass filter to make it sound muffled/heavy
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, time);

        osc.connect(filter);
        filter.connect(gainOsc);
        gainOsc.connect(audioCtx.destination);

        osc.start(time);
        osc.stop(time + 0.25);
    } catch (e) {
        console.warn('Som não pôde ser sintetizado:', e);
    }
}

// 4. Pickup Sound (Health/Ammo Collect): Two fast rising triangle waves (440Hz -> 660Hz)
export function playPickup() {
    try {
        initAudio();
        if (!audioCtx) return;

        const time = audioCtx.currentTime;

        const osc = audioCtx.createOscillator();
        const gainOsc = audioCtx.createGain();
        
        osc.type = 'triangle';
        
        // Dynamic Arpeggio: 440Hz for 0.07s, then 660Hz for 0.15s
        osc.frequency.setValueAtTime(440, time);
        osc.frequency.setValueAtTime(660, time + 0.07);
        
        gainOsc.gain.setValueAtTime(0.3, time);
        gainOsc.gain.exponentialRampToValueAtTime(0.01, time + 0.22);

        osc.connect(gainOsc);
        gainOsc.connect(audioCtx.destination);
        
        osc.start(time);
        osc.stop(time + 0.22);
    } catch (e) {
        console.warn('Som não pôde ser sintetizado:', e);
    }
}

// Expose trigger to initialize audio from main client file on Click
window.initAudioContext = initAudio;
