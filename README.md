# SC300i-OGS-Plugin
A Plugin for Open Golf Simulator that uses the Swing Caddie 300i for gameplay

Features
Native Integration: Seamlessly connects to your SC300i radar via Bluetooth Low Energy (BLE).

Automatic Sync: Dynamically updates the hardware display on your SC300i to match the club you select in OpenGolfSim.

Smart Filtering: Automatically clamps "garbage" data (topped ball misreads) to ensure a smooth simulation experience.

Auto-Reconnect: Automatically detects if your radar disconnects or powers down and resumes scanning the moment it comes back online.

Installation
Download the Plugin: Visit the Releases page and download the latest Source code (zip) file.

Locate your Plugins Folder:

Windows: Open %USERPROFILE%\AppData\Roaming\opengolfsim-desktop\plugins\ in your File Explorer.

macOS: Navigate to ~/Library/Application Support/opengolfsim-desktop/plugins/.

Install: Extract the contents of the ZIP file directly into the plugins folder.

Restart: Restart OpenGolfSim. The plugin will automatically detect and connect to your SC300i when it is powered on and within range.

Troubleshooting
Radar not connecting? Ensure that no other apps (like the Voice Caddie mobile app) are currently connected to the SC300i, as the radar can only maintain one Bluetooth connection at a time.

Logs: If you experience issues, you can view the plugin debug logs within the OpenGolfSim console to see connection status and raw packet data.

Club Mapping
This plugin uses an internal dictionary to map OGS club IDs to SC300i hardware indexes. If you find a club that is not mapping correctly, please open an Issue so we can update the mapping table.

Credits & License
Built for the OpenGolfSim community. This project is provided as-is under the MIT License.
