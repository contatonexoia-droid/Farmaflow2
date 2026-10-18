const sql = require('mssql');

sql.on('error', err => {
    console.error('Erro global na conexão MSSQL (InovaFarma):', err.message);
});

class InovaFarmaConnector {
    constructor(dbConfig) {
        this.dbConfig = {
            user: dbConfig.user || 'sa',
            password: dbConfig.password,
            server: dbConfig.server || 'localhost',
            port: Number(dbConfig.port) || 1433,
            database: dbConfig.database || 'INOVAFARMA',
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true
            }
        };
        this.viewName = dbConfig.viewName || 'VW_INTEGRACAO_FARMAFLOW';
        this.branchCode = dbConfig.branchCode || null;
    }

    /**
     * Repassador universal: ao executar o SELECT na View do ERP,
     * envia no JSON todas as colunas retornadas pela View para o servidor,
     * sem descartar colunas extras.
     */
    async getChangedRecords(lastSyncDate) {
        let pool;
        try {
            pool = await sql.connect(this.dbConfig);
            
            let query = `SELECT * FROM ${this.viewName}`;
            const request = pool.request();
            const conditions = [];

            if (lastSyncDate && lastSyncDate !== '1970-01-01T00:00:00.000Z') {
                conditions.push(`(data_ultima_alteracao IS NULL OR data_ultima_alteracao > @lastSync)`);
                request.input('lastSync', sql.DateTime, new Date(lastSyncDate));
            }

            if (this.branchCode) {
                conditions.push(`codigo_filial = @branchCode`);
                request.input('branchCode', sql.VarChar, this.branchCode);
            }

            if (conditions.length > 0) {
                query += ` WHERE ${conditions.join(' AND ')}`;
            }

            try {
                const orderedQuery = query + ` ORDER BY data_ultima_alteracao ASC`;
                const result = await request.query(orderedQuery);
                return result.recordset || [];
            } catch (queryErr) {
                // Fallback resiliente: se a View não tiver a coluna data_ultima_alteracao
                const simpleQuery = `SELECT * FROM ${this.viewName}`;
                const simpleResult = await pool.request().query(simpleQuery);
                return simpleResult.recordset || [];
            }
        } finally {
            if (pool) {
                try {
                    await pool.close();
                } catch (err) {
                    console.error('Erro ao fechar conexão com InovaFarma:', err.message);
                }
            }
        }
    }
}

module.exports = InovaFarmaConnector;
