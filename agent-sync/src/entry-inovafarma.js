const { startAgent } = require('./runner');
const InovaFarmaConnector = require('./connectors/inovafarma');

process.on('uncaughtException', (err) => {
    console.error('Erro não tratado no Agente InovaFarma:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejeição não tratada no Agente InovaFarma:', reason);
});

startAgent('inovafarma', InovaFarmaConnector);
