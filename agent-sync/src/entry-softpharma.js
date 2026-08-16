const { startAgent } = require('./runner');
const SoftpharmaConnector = require('./connectors/softpharma');

process.on('uncaughtException', (err) => {
    console.error('Erro não tratado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejeição não tratada:', reason);
});

startAgent('softpharma', SoftpharmaConnector);
