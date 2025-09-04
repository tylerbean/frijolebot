const { EmbedBuilder, MessageFlags } = require('discord.js');
const Logger = require('../utils/logger');

class CommandHandler {
    constructor(baserowService, reactionHandler, config) {
        this.baserowService = baserowService;
        this.reactionHandler = reactionHandler;
        this.config = config;
    }

    async handleUnreadCommand(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const username = interaction.user.username;
            const guildId = interaction.guildId;
            
            Logger.info(`/unread command called by:`, {
                username: username,
                userId: interaction.user.id,
                guildId: guildId,
                guildName: interaction.guild?.name
            });
            
            // Handle DM usage - show unread links from all servers
            if (!guildId) {
                Logger.info('Command used in DM - fetching unread links from all servers');
                const unreadLinks = await this.baserowService.getUnreadLinksForUserAllGuilds(username);
                
                if (unreadLinks.length === 0) {
                    await interaction.editReply({
                        content: '🎉 You\'re all caught up! No unread links from others in any server.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }
                
                // Create embed with unread links from all servers
                const embed = new EmbedBuilder()
                    .setTitle('📚 Unread Links (All Servers)')
                    .setDescription(`You have ${unreadLinks.length} unread link(s) shared by others:\n\n**React to mark as read, remove reaction to mark as unread**`)
                    .setColor(0x00AE86)
                    .setTimestamp();

                // Add fields for each link (max 25 fields per embed)
                const linksToShow = unreadLinks.slice(0, 25);
                linksToShow.forEach((link, index) => {
                    const channelName = link.channel_name || 'unknown';
                    const poster = link.user || 'unknown';
                    const timestamp = link.timestamp ? new Date(link.timestamp).toLocaleDateString() : 'unknown';
                    const guildName = link.guild_name || 'Unknown Server';
                    
                    // Create Discord message jump link
                    const messageLink = `https://discord.com/channels/${link.guild_id}/${link.channel_id}/${link.message_id}`;
                    
                    embed.addFields({
                        name: `${index + 1}. From ${poster} in #${channelName} (${guildName})`,
                        value: `[Jump to message](${messageLink})\nOriginal URL: ${link.url}\n*Posted: ${timestamp}*`,
                        inline: false
                    });
                });

                if (unreadLinks.length > 25) {
                    embed.setFooter({ text: `Showing first 25 of ${unreadLinks.length} unread links` });
                }

                // Send DM to user
                try {
                    const dmChannel = await interaction.user.createDM();
                    const dmMessage = await dmChannel.send({ embeds: [embed] });
                    
                    // Add reactions for each link
                    const reactions = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
                    for (let i = 0; i < Math.min(linksToShow.length, 10); i++) {
                        await dmMessage.react(reactions[i]);
                        // Create database mapping for reaction emoji to original message ID
                        await this.baserowService.createDMMapping(
                            dmMessage.id, 
                            reactions[i], 
                            linksToShow[i].message_id, 
                            linksToShow[i].guild_id, 
                            interaction.user.id
                        );
                    }
                    
                    // If more than 10 links, add additional reactions for links 11-25
                    if (linksToShow.length > 10) {
                        const additionalReactions = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯', '🇰', '🇱', '🇲', '🇳', '🇴'];
                        for (let i = 10; i < Math.min(linksToShow.length, 25); i++) {
                            const reactionIndex = i - 10;
                            await dmMessage.react(additionalReactions[reactionIndex]);
                            // Create database mapping for additional reactions
                            await this.baserowService.createDMMapping(
                                dmMessage.id, 
                                additionalReactions[reactionIndex], 
                                linksToShow[i].message_id, 
                                linksToShow[i].guild_id, 
                                interaction.user.id
                            );
                        }
                    }
                    
                    // Add checkmark reaction for "mark all as read" functionality
                    await dmMessage.react('✅');
                    // Create bulk database mapping for checkmark
                    await this.baserowService.createBulkDMMapping(
                        dmMessage.id, 
                        linksToShow.map(link => link.message_id), 
                        'all_guilds', // Special identifier for all guilds
                        interaction.user.id
                    );
                    
                    await interaction.editReply({
                        content: '📬 I\'ve sent you a DM with your unread links from all servers! React to mark as read, remove reaction to mark as unread.',
                        flags: MessageFlags.Ephemeral
                    });
                    
                } catch (dmError) {
                    Logger.error('Error sending DM:', dmError);
                    await interaction.editReply({
                        content: '❌ I couldn\'t send you a DM. Please check your privacy settings.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }
            
            const unreadLinks = await this.baserowService.getUnreadLinksForUser(username, guildId);
            
            if (unreadLinks.length === 0) {
                await interaction.editReply({
                    content: '🎉 You\'re all caught up! No unread links from others.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Create embed with unread links
            const embed = new EmbedBuilder()
                .setTitle('📚 Unread Links')
                .setDescription(`You have ${unreadLinks.length} unread link(s) shared by others:\n\n**React to mark as read, remove reaction to mark as unread**`)
                .setColor(0x00AE86)
                .setTimestamp();

            // Add fields for each link (max 25 fields per embed)
            const linksToShow = unreadLinks.slice(0, 25);
            linksToShow.forEach((link, index) => {
                const channelName = link.channel_name || 'unknown';
                const poster = link.user || 'unknown';
                const timestamp = link.timestamp ? new Date(link.timestamp).toLocaleDateString() : 'unknown';
                
                // Create Discord message jump link
                const messageLink = `https://discord.com/channels/${this.config.discord.guildId}/${link.channel_id}/${link.message_id}`;
                
                embed.addFields({
                    name: `${index + 1}. From ${poster} in #${channelName}`,
                    value: `[Jump to message](${messageLink})\nOriginal URL: ${link.url}\n*Posted: ${timestamp}*`,
                    inline: false
                });
            });

            if (unreadLinks.length > 25) {
                embed.setFooter({ text: `Showing first 25 of ${unreadLinks.length} unread links` });
            }

            // Send DM to user
            try {
                const dmChannel = await interaction.user.createDM();
                const dmMessage = await dmChannel.send({ embeds: [embed] });
                
                // Add reactions for each link
                const reactions = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
                for (let i = 0; i < Math.min(linksToShow.length, 10); i++) {
                    await dmMessage.react(reactions[i]);
                    // Create database mapping for reaction emoji to original message ID
                    await this.baserowService.createDMMapping(
                        dmMessage.id, 
                        reactions[i], 
                        linksToShow[i].message_id, 
                        guildId, 
                        interaction.user.id
                    );
                }
                
                // If more than 10 links, add additional reactions for links 11-25
                if (linksToShow.length > 10) {
                    const additionalReactions = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯', '🇰', '🇱', '🇲', '🇳', '🇴'];
                    for (let i = 10; i < Math.min(linksToShow.length, 25); i++) {
                        const reactionIndex = i - 10;
                        await dmMessage.react(additionalReactions[reactionIndex]);
                        // Create database mapping for additional reactions
                        await this.baserowService.createDMMapping(
                            dmMessage.id, 
                            additionalReactions[reactionIndex], 
                            linksToShow[i].message_id, 
                            guildId, 
                            interaction.user.id
                        );
                    }
                }
                
                // Add checkmark reaction for "mark all as read" functionality
                await dmMessage.react('✅');
                // Create bulk database mapping for checkmark
                await this.baserowService.createBulkDMMapping(
                    dmMessage.id, 
                    linksToShow.map(link => link.message_id), 
                    guildId, 
                    interaction.user.id
                );
                
                await interaction.editReply({
                    content: '📬 I\'ve sent you a DM with your unread links! React to mark as read, remove reaction to mark as unread.',
                    flags: MessageFlags.Ephemeral
                });
                
            } catch (dmError) {
                Logger.error('Error sending DM:', dmError);
                await interaction.editReply({
                    content: '❌ I couldn\'t send you a DM. Please check your privacy settings.',
                    flags: MessageFlags.Ephemeral
                });
            }
            
        } catch (error) {
            Logger.error('Error handling unread command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while fetching your unread links.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

module.exports = CommandHandler;
