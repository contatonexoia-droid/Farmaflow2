const { startAgent } = require('./runner');
const SoftpharmaConnector = require('./connectors/softpharma');

startAgent('softpharma', SoftpharmaConnector);
