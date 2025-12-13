/**
 * Test Module Commands
 *
 * Defines the slash commands available for the test module
 */

const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Test command from the test module')
    .setDMPermission(false)
];
