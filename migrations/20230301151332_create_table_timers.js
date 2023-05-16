/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable("timers", (table) => {
    table.increments("id");
    table.string("timer_id", 255).notNullable();
    table.integer("user_id").nullable();
    table.foreign("user_id").references("users.id");
    table.string("description", 255).notNullable();
    table.bigint("start_timestamp").notNullable()
    table.bigint("end_timestamp").notNullable().defaultTo(0);
    table.bigint("duration").notNullable().defaultTo(0);
    table.bigint("progress").notNullable().defaultTo(0);
    table.boolean("is_active");
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable("timers");
};
