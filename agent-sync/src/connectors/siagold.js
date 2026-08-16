const sql = require('mssql');

sql.on('error', err => {
    console.error('Erro global na conexão MSSQL:', err.message);
});

class SiagoldConnector {
    constructor(dbConfig) {
        this.dbConfig = {
            user: dbConfig.user,
            password: dbConfig.password,
            server: dbConfig.server,
            database: dbConfig.database,
            options: {
                encrypt: false,
                trustServerCertificate: true
            }
        };
        this.viewName = dbConfig.viewName || 'VW_INTEGRACAO_FARMAFLOW';
        this.branchCode = dbConfig.branchCode || null;
    }

    async getChangedRecords(lastSyncDate) {
        let pool;
        try {
            pool = await sql.connect(this.dbConfig);
            
            let query = `
                SELECT * FROM ${this.viewName}
                WHERE data_ultima_alteracao > @lastSync
            `;

            if (this.branchCode) {
                query += ` AND codigo_filial = @branchCode`;
            }

            query += ` ORDER BY data_ultima_alteracao ASC`;
            
            const request = pool.request()
                .input('lastSync', sql.DateTime, new Date(lastSyncDate));

            if (this.branchCode) {
                request.input('branchCode', sql.VarChar, this.branchCode);
            }

            const result = await request.query(query);

            return result.recordset;
        } finally {
            if (pool) {
                try {
                    await pool.close();
                } catch (err) {
                    console.error('Erro ao fechar conexão com o banco:', err.message);
                }
            }
        }
    }
}

module.exports = SiagoldConnector;
