const { startAgent } = require('./runner');
const SiagoldConnector = require('./connectors/siagold');

startAgent('siagold', SiagoldConnector);
