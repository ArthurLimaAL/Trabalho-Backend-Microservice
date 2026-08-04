const fs = require('fs');
const path = require('fs');
const db = require('../config/db');

    async function runMigrations() {
        try{
            const sqlPath = path.join(__dirname, 'init.sql');
            const sql = fs.readFileSync(sqlPath, 'utf8');

            await db.query(sql);
            console.log(' Migrações do banco executadas com sucesso!')
        }
        catch (error) {
    console.error(' Erro ao executar migrações:', error);
    }
    module.exports = runMigrations;