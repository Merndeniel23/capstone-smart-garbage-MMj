import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false,
  },
});

try {
  await connection.query(`
    ALTER TABLE barangays
    ADD COLUMN address VARCHAR(255) NULL AFTER name
  `).catch((error: any) => {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  });

  await connection.query(`
    ALTER TABLE barangays
    ADD COLUMN image_url MEDIUMTEXT NULL AFTER address
  `).catch((error: any) => {
    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
  });

  const [rows] = await connection.query("DESCRIBE barangays");

  console.log("Barangays table updated successfully:");
  console.table(rows);
} finally {
  await connection.end();
}
