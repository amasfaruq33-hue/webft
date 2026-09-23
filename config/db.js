const mysql = require('mysql2/promise');

let poolConfig;

if (process.env.MYSQL_URL) {
    poolConfig = {
        uri: process.env.MYSQL_URL,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };
} else if (process.env.MYSQLHOST) {
    poolConfig = {
        host: process.env.MYSQLHOST,
        user: process.env.MYSQLUSER || 'root',
        password: process.env.MYSQLPASSWORD || '',
        database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'ricoft',
        port: parseInt(process.env.MYSQLPORT) || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };
} else {
    poolConfig = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || '',
        database: process.env.DB_NAME || 'ricoft',
        port: parseInt(process.env.DB_PORT) || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;
