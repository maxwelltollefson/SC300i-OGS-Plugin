// ==========================================
// SC300i OpenGolfSim Plugin
// Native OGS Dash-less UUIDs
// ==========================================
const NOTIFY_UUID = "3030000353656964646163676e697773";
const WRITE_UUID = "3030000253656964646163676e697773";

let currentShot = {};
let currentShotNumber = 1;
let globalWriteChar = null; 
let currentClubId = "DR"; // Dynamically tracks active club to fix misreads

// Helper for asynchronous delays
const delay = ms => new Promise(res => setTimeout(res, ms));

// Typical club launch angles mapped directly from your OGS profile configuration
const CLUB_FALLBACK_ANGLES = {
    "DR": 10.5, "1W": 10.5,
    "3W": 14.0,
    "4W": 16.0,
    "5W": 18.0,
    "6W": 19.0,
    "7W": 21.0,
    "3U": 20.0, "3H": 20.0,
    "4U": 22.0, "4H": 22.0,
    "5U": 24.0, "5H": 24.0,
    "6U": 26.0, "6H": 26.0,
    "7U": 28.0, "7H": 28.0,
    "3I": 20.0,
    "4I": 23.0,
    "5I": 26.0,
    "6I": 30.0,
    "7I": 34.0,
    "8I": 37.0,
    "9I": 42.0,
    "PW": 45.0,
    "AW": 48.0, "GW": 48.0,
    "SW": 52.0,
    "LW": 60.0,
    "PT": 0.0
};

// ==========================================
// 1. DATA DECODING & PACKET BUILDING
// ==========================================
function generateChecksum(packet) {
    let sum = 0;
    for (let i = 0; i < 19; i++) sum += packet[i];
    return ((~sum) + 1) & 0xFF;
}

function buildCommandPacket(cmd, payload) {
    let packet = new Uint8Array(20);
    packet[0] = 0x53; 
    packet[1] = cmd;  
    packet.set(payload, 2); 
    packet[18] = 0x45; 
    packet[19] = generateChecksum(packet);
    return packet;
}

function parseSequence(data) {
    let uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (uint8.length < 19) return null;
    if (uint8[0] !== 0x53 || uint8[1] !== 0x73) return null;

    let seq = uint8[4];
    let dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);

    try {
        if (seq === 2) {
            currentShot.ballSpeed = dv.getFloat32(13, true) * 2.23694; 
        } else if (seq === 3) {
            let rawVla = dv.getFloat32(9, true);
            
            // Dynamic check for topped ball garbage data
            if (rawVla > 80) {
                let correctedAngle = CLUB_FALLBACK_ANGLES[currentClubId] || 15.0;
                currentShot.vla = correctedAngle;
                logging.info(`⚠️ Garbage VLA detected (${rawVla}°). Dynamic replacement: setting to ${correctedAngle}° for ${currentClubId}.`);
            } else {
                currentShot.vla = rawVla;
            }
        } else if (seq === 4) {
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
    if (!globalWriteChar) return;

    try {
        logging.info(`🔄 Syncing Club Index ${clubIndex} to SC300i...`);

        let p1 = new Uint8Array(16);
        p1[0] = 0x20; 
        p1[13] = clubIndex; 
        let pkt1 = buildCommandPacket(111, p1);

        let p2 = new Uint8Array(16); 
        let pkt2 = buildCommandPacket(110, p2);

        let p3 = new Uint8Array(16); 
        let pkt3 = buildCommandPacket(48, p3);

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
const OGS_TO_SC300_MAP = {
    "DR": 0, "1W": 0, "3W": 1, "4W": 2, "5W": 3, "6W": 4, "7W": 5,
    "3U": 6, "3H": 6, "4U": 7, "4H": 7, "5U": 8, "5H": 8, "6U": 9, "6H": 9, "7U": 10, "7H": 10,
    "3I": 11, "4I": 12, "5I": 13, "6I": 14, "7I": 15, "8I": 16, "9I": 17,
    "PW": 18, "AW": 19, "GW": 19, "SW": 20, "LW": 21, "PT": 15
};

shotData.on('club', (incomingData) => {
    let clubIndex = 15; 
    let ogsId = null;

    try {
        if (typeof incomingData === 'string') {
            ogsId = incomingData.toUpperCase();
        } else if (incomingData && typeof incomingData === 'object') {
            if (incomingData.club && incomingData.club.id) {
                ogsId = incomingData.club.id.toUpperCase();
            } else if (incomingData.id) {
                ogsId = incomingData.id.toUpperCase();
            } else if (incomingData.name) {
                ogsId = incomingData.name.toUpperCase();
            }
        }

        if (ogsId) {
            currentClubId = ogsId; // Cache the ID for the misread parser logic
            if (OGS_TO_SC300_MAP[ogsId] !== undefined) {
                clubIndex = OGS_TO_SC300_MAP[ogsId];
            }
        } else if (typeof incomingData === 'number') {
            clubIndex = incomingData;
        }
    } catch (e) {
        logging.error("Error parsing OGS club data: " + e);
    }

    executeClubSync(clubIndex);
});

// ==========================================
// 4. BLUETOOTH CONNECTION & AUTO-RECONNECT
// ==========================================
const bleClient = bluetooth.createClient();

bleClient.on('discover', async (device) => {
    if (device.advertisement && device.advertisement.localName && device.advertisement.localName.includes("SC300")) {
        try {
            await bleClient.stopScanning();
            await device.connect();
            shotData.updateDeviceStatus({ isConnected: true, isReady: true });
            logging.info("✅ Connected to SC300i");
            
            device.on('disconnect', async () => {
                logging.info("⚠️ SC300i Disconnected. Cleaning up...");
                globalWriteChar = null; 
                shotData.updateDeviceStatus({ isConnected: false, isReady: false });
                
                await delay(2000); 
                
                try {
                    logging.info("🔍 Attempting Auto-Reconnect. Resuming scan...");
                    await bleClient.startScanning();
                } catch (err) {
                    logging.error("Failed to restart scan: " + err);
                }
            });

            const discovery = await device.discoverAllServicesAndCharacteristics();
            const notifyChar = discovery.characteristics.find(c => c.uuid.replace(/-/g, '').toLowerCase() === NOTIFY_UUID);
            const writeChar = discovery.characteristics.find(c => c.uuid.replace(/-/g, '').toLowerCase() === WRITE_UUID);

            if (notifyChar && writeChar) {
                globalWriteChar = writeChar; 

                notifyChar.on('data', (d) => {
                    let ack = parseSequence(d);
                    if (ack && globalWriteChar) globalWriteChar.write(ack.buffer, true);
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
