const { startAgent } = require('./runner');
const SiagoldConnector = require('./connectors/siagold');

process.on('uncaughtException', (err) => {
    console.error('Erro não tratado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejeição não tratada:', reason);
});

startAgent('siagold', SiagoldConnector);
