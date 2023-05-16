require('dotenv').config()

module.exports = {
  client: "pg",
  // если файлы проекта содержат миграции то прописвать для Knex подключение к БД нужно в 2 местах
  // тут объект connention нужен для миграций
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  migrations: {tableName: "knex_migrations"},
  // у elephantsql.com существует ограничение на одновременные подключения к БД - не больше 3
  pool: {min: 0, max: 3}
};
