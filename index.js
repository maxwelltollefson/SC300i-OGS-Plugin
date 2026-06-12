// ==========================================
// SC300i OpenGolfSim Plugin
// Native OGS Dash-less UUIDs
// ==========================================
const NOTIFY_UUID = "3030000353656964646163676e697773";
const WRITE_UUID = "3030000253656964646163676e697773";

let currentShot = {};
let currentShotNumber = 1;
let globalWriteChar = null; // Stored globally to allow outbound sync requests

// Helper for asynchronous delays
const delay = ms => new Promise(res => setTimeout(res, ms));

// ==========================================
// 1. DATA DECODING & PACKET BUILDING
// ==========================================
function generateChecksum(packet) {
    let sum = 0;
    for (let i = 0; i < 19; i++) sum += packet[i];
    return ((~sum) + 1) & 0xFF;
}

function buildCommandPacket(cmd, payload) {
    // BasePacket format: [0x53, CMD, ...16 bytes payload..., 0x45, CHECKSUM]
    let packet = new Uint8Array(20);
    packet[0] = 0x53; // START
    packet[1] = cmd;  // CMD
    packet.set(payload, 2); // Insert 16-byte payload at index 2
    packet[18] = 0x45; // END
    packet[19] = generateChecksum(packet);
    return packet;
}

function parseSequence(data) {
    // Convert input to Uint8Array for sandbox safety
    let uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (uint8.length < 19) return null;
    if (uint8[0] !== 0x53 || uint8[1] !== 0x73) return null;

    let seq = uint8[4];
    let dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);

    try {
        if (seq === 2) {
            // Ball Speed (converting from m/s to mph)
            currentShot.ballSpeed = dv.getFloat32(13, true) * 2.23694; 
        } else if (seq === 3) {
            // Vertical Launch Angle
            let rawVla = dv.getFloat32(9, true);
            
            // Fix for topped balls sending garbage high angles (e.g., 113, 134)
            if (rawVla > 80) {
                currentShot.vla = 8.0;
                logging.info(`⚠️ Garbage VLA detected (${rawVla}°). Clamping to 8.0° for topped shot.`);
            } else {
                currentShot.vla = rawVla;
            }
            
        } else if (seq === 4) {
            // Spin Rate & Final Shot Dispatch
            let spinRate = dv.getFloat32(13, true);
            if (currentShot.ballSpeed > 0) {
                shotData.sendShot({
                    shotNumber: currentShotNumber++,
                    ballSpeed: currentShot.ballSpeed,
                    verticalLaunchAngle: currentShot.vla || 0,
                    horizontalLaunchAngle: 0.0,
                    spinSpeed: spinRate,
                    spinAxis: 0.0
                });
            }
            currentShot = {}; 
        }
    } catch (e) { logging.error("Parse Error: " + e); }

    // Build Two's Complement ACK packet (Mandatory Heartbeat)
    let ack = new Uint8Array(20);
    ack[0] = 0x53; ack[1] = 0x73;
    ack[2] = uint8[2]; ack[3] = uint8[3];
    ack[4] = seq; ack[18] = 0x45;
    ack[19] = generateChecksum(ack);
    return ack;
}

// ==========================================
// 2. OUTBOUND CLUB SYNC TO RADAR
// ==========================================
async function executeClubSync(clubIndex) {
    if (!globalWriteChar) {
        logging.error("Cannot sync club: SC300i Write Characteristic not available.");
        return;
    }

    try {
        logging.info(`🔄 Syncing Club Index ${clubIndex} to SC300i...`);

        // Phase 1: Propose Setting 1 (0x6F - 111)
        let p1 = new Uint8Array(16);
        p1[0] = 0x20; // mFlag = 0x20 (CLUB update constant)
        p1[13] = clubIndex; // mClub index
        let pkt1 = buildCommandPacket(111, p1);

        // Phase 2: Commit Setting 2 (0x6E - 110)
        let p2 = new Uint8Array(16); // Default 0s matching BasePacket logic
        let pkt2 = buildCommandPacket(110, p2);

        // Phase 3: Admin Setting Refresh (0x30 - 48)
        let p3 = new Uint8Array(16); // Default 0s
        let pkt3 = buildCommandPacket(48, p3);

        // Send Sequence with mandatory 300ms firmware delays
        await globalWriteChar.write(pkt1.buffer, true);
        await delay(300);
        await globalWriteChar.write(pkt2.buffer, true);
        await delay(300);
        await globalWriteChar.write(pkt3.buffer, true);

        logging.info("✅ SC300i hardware display refresh requested.");
    } catch (e) {
        logging.error("Club Sync Error: " + e);
    }
}

// ==========================================
// 3. OGS EVENT LISTENERS & CLUB MAPPING
// ==========================================

// Dictionary to map OGS string IDs to SC300i integer indices
const OGS_TO_SC300_MAP = {
    "DR": 0, "1W": 0,
    "3W": 1,
    "4W": 2,
    "5W": 3,
    "6W": 4,
    "7W": 5,
    "3U": 6, "3H": 6,
    "4U": 7, "4H": 7,
    "5U": 8, "5H": 8,
    "6U": 9, "6H": 9,
    "7U": 10, "7H": 10,
    "3I": 11,
    "4I": 12,
    "5I": 13,
    "6I": 14,
    "7I": 15,
    "8I": 16,
    "9I": 17,
    "PW": 18,
    "AW": 19, "GW": 19,
    "SW": 20,
    "LW": 21,
    "PT": 15 // Radar doesn't have putter, fallback to an iron
};

shotData.on('club', (incomingData) => {
    let clubIndex = 15; // Default fallback (7-Iron)
    let ogsId = null;

    try {
        // Debug exactly what OGS is feeding the plugin
        logging.info("Raw OGS Club Payload: " + JSON.stringify(incomingData));

        // Aggressive extraction: check every possible shape the data might take
        if (typeof incomingData === 'string') {
            ogsId = incomingData.toUpperCase();
        } 
        else if (incomingData && typeof incomingData === 'object') {
            if (incomingData.club && incomingData.club.id) {
                ogsId = incomingData.club.id.toUpperCase();
            } else if (incomingData.id) {
                ogsId = incomingData.id.toUpperCase();
            } else if (incomingData.name) {
                ogsId = incomingData.name.toUpperCase();
            }
        }

        // Map the extracted string to the SC300i integer index
        if (ogsId && OGS_TO_SC300_MAP[ogsId] !== undefined) {
            clubIndex = OGS_TO_SC300_MAP[ogsId];
        } else if (typeof incomingData === 'number') {
            clubIndex = incomingData;
        } else {
            logging.error(`Could not map OGS club ID [${ogsId}] - Defaulting to 7-Iron.`);
        }
    } catch (e) {
        logging.error("Error parsing OGS club data: " + e);
    }

    // Fire the sync to the physical SC300i hardware
    executeClubSync(clubIndex);
});

// ==========================================
// 4. BLUETOOTH CONNECTION & LIFECYCLE
// ==========================================
const bleClient = bluetooth.createClient();

bleClient.on('discover', async (device) => {
    if (device.advertisement && device.advertisement.localName && device.advertisement.localName.includes("SC300")) {
        try {
            await bleClient.stopScanning();
            await device.connect();
            shotData.updateDeviceStatus({ isConnected: true, isReady: true });
            logging.info("✅ Connected to SC300i");
            
            const discovery = await device.discoverAllServicesAndCharacteristics();
            const notifyChar = discovery.characteristics.find(c => c.uuid.replace(/-/g, '').toLowerCase() === NOTIFY_UUID);
            const writeChar = discovery.characteristics.find(c => c.uuid.replace(/-/g, '').toLowerCase() === WRITE_UUID);

            if (notifyChar && writeChar) {
                // Save the write characteristic globally so our OGS listeners can access it
                globalWriteChar = writeChar; 

                notifyChar.on('data', (d) => {
                    let ack = parseSequence(d);
                    // Send mandatory keep-alive acknowledgement immediately
                    if (ack) writeChar.write(ack.buffer, true);
                });
                await notifyChar.subscribe();
            } else {
                logging.error("❌ Required SC300i characteristics not found.");
            }
        } catch (e) { logging.error("Connection Error: " + e); }
    }
});

system.on('exit', async () => { 
    try { 
        logging.info("🛑 Shutting down SC300i plugin...");
        await bleClient.stopScanning(); 
    } catch (e) {} 
});

async function init() {
    try {
        await bleClient.waitForPoweredOn(5000);
        logging.info("🔍 Searching for SC300i Radar...");
        await bleClient.startScanning();
    } catch (e) { logging.error("Init Error: " + e); }
}

init();