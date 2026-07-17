const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.cwd(), 'farmaflow_config.json');

function loadConfig() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return null;
}

function saveConfig(config) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(config, null, 2));
}

function getLastSyncDate() {
    const config = loadConfig();
    return (config && config.lastSyncDate) ? config.lastSyncDate : '1970-01-01T00:00:00.000Z';
}

function updateLastSyncDate(dateStr) {
    const config = loadConfig() || {};
    config.lastSyncDate = dateStr;
    saveConfig(config);
}

module.exports = {
    loadConfig,
    saveConfig,
    getLastSyncDate,
    updateLastSyncDate
};
