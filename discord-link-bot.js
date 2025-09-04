require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, MessageFlags, Partials } = require('discord.js');
const BaserowService = require('./services/BaserowService');

// Load environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const BASEROW_API_TOKEN = process.env.BASEROW_API_TOKEN;
const BASEROW_API_URL = process.env.BASEROW_API_URL;

// Get all channel IDs from environment variables
const channelIds = Object.keys(process.env)
  .filter(key => key.startsWith('DISCORD_CHANNEL_'))
  .map(key => process.env[key])
  .filter(id => id && id !== 'your_channel_id_here');

console.log('Bot starting...');
console.log('Monitoring channels:', channelIds);

// Validate required environment variables
if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !BASEROW_API_TOKEN || !BASEROW_API_URL) {
  console.error('Missing required environment variables. Please check your .env file.');
  process.exit(1);
}

// Configuration
const config = {
    token: DISCORD_BOT_TOKEN,
    guildId: DISCORD_GUILD_ID, // Frijoleville server ID
    channelsToMonitor: channelIds
};

// Initialize services
const baserowService = new BaserowService(BASEROW_API_TOKEN, BASEROW_API_URL);

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

// URL detection regex
const urlRegex = /(https?:\/\/[^\s]+)/g;

// Store mapping of DM message IDs to original message IDs for reaction handling
const dmMessageMap = new Map();

// Define slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('unread')
        .setDescription('Get a list of unread links shared by others')
        .setDMPermission(true)
];

// Register slash commands
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
    
    try {
        console.log('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Bot ready event
client.once('clientReady', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`📡 Monitoring ${config.channelsToMonitor.length} channels in guild ${config.guildId}`);
    
    // Register slash commands
    await registerCommands();
    
    // Log channel names for verification
    config.channelsToMonitor.forEach(channelId => {
        const channel = client.channels.cache.get(channelId);
        if (channel) {
            console.log(`📺 Monitoring channel: #${channel.name} (${channelId})`);
        } else {
            console.log(`⚠️  Channel ${channelId} not found or not accessible`);
        }
    });
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'unread') {
        await handleUnreadCommand(interaction);
    }
});



// Handle unread command
async function handleUnreadCommand(interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const username = interaction.user.username;
        const unreadLinks = await baserowService.getUnreadLinksForUser(username);
        
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
            .setDescription(`You have ${unreadLinks.length} unread link(s) shared by others:`)
            .setColor(0x00AE86)
            .setTimestamp();

        // Add fields for each link (max 25 fields per embed)
        const linksToShow = unreadLinks.slice(0, 25);
        linksToShow.forEach((link, index) => {
            const channelName = link.channel_name || 'unknown';
            const poster = link.user || 'unknown';
            const timestamp = link.timestamp ? new Date(link.timestamp).toLocaleDateString() : 'unknown';
            
            // Create Discord message jump link
            const messageLink = `https://discord.com/channels/${config.guildId}/${link.channel_id}/${link.message_id}`;
            
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
                // Map reaction emoji to original message ID
                dmMessageMap.set(`${dmMessage.id}-${reactions[i]}`, linksToShow[i].message_id);
            }
            
            // If more than 10 links, add additional reactions for links 11-25
            if (linksToShow.length > 10) {
                const additionalReactions = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯', '🇰', '🇱', '🇲', '🇳', '🇴'];
                for (let i = 10; i < Math.min(linksToShow.length, 25); i++) {
                    const reactionIndex = i - 10;
                    await dmMessage.react(additionalReactions[reactionIndex]);
                    // Map reaction emoji to original message ID
                    dmMessageMap.set(`${dmMessage.id}-${additionalReactions[reactionIndex]}`, linksToShow[i].message_id);
                }
            }
            
            // Add checkmark reaction for "mark all as read" functionality
            await dmMessage.react('✅');
            // Map checkmark to all message IDs for bulk marking
            dmMessageMap.set(`${dmMessage.id}-✅`, linksToShow.map(link => link.message_id));
            
            await interaction.editReply({
                content: '📬 I\'ve sent you a DM with your unread links! React to mark them as read.',
                flags: MessageFlags.Ephemeral
            });
            
        } catch (dmError) {
            console.error('Error sending DM:', dmError);
            await interaction.editReply({
                content: '❌ I couldn\'t send you a DM. Please check your privacy settings.',
                flags: MessageFlags.Ephemeral
            });
        }
        
    } catch (error) {
        console.error('Error handling unread command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while fetching your unread links.',
            flags: MessageFlags.Ephemeral
        });
    }
}













// Function to check if user is admin
async function isUserAdmin(member) {
    try {
        // Check for Discord Administrator permission (most reliable)
        if (member.permissions.has('Administrator')) {
            return true;
        }
        
        // Check for ManageMessages permission (common for moderators)
        if (member.permissions.has('ManageMessages')) {
            return true;
        }
        
        // Check for roles by name (case-insensitive)
        const hasAdminRole = member.roles.cache.some(role => {
            const roleName = role.name.toLowerCase();
            return roleName === 'admin' || 
                   roleName === 'administrator' || 
                   roleName.includes('admin') || 
                   roleName === 'moderator' || 
                   roleName === 'mod' ||
                   roleName.includes('moderator');
        });
        
        console.log(`🔍 Admin check for ${member.user.username}:`);
        console.log(`   - Administrator permission: ${member.permissions.has('Administrator')}`);
        console.log(`   - ManageMessages permission: ${member.permissions.has('ManageMessages')}`);
        console.log(`   - Admin role found: ${hasAdminRole}`);
        console.log(`   - User roles: ${member.roles.cache.map(role => role.name).join(', ')}`);
        
        return hasAdminRole;
    } catch (error) {
        console.error('Error checking admin permissions:', error);
        return false;
    }
}

// Message event handler
client.on('messageCreate', async (message) => {
    try {
        // Skip bot messages
        if (message.author.bot) return;
        
        // Only process messages from configured guild
        if (message.guild?.id !== config.guildId) return;
        
        // Only process messages from monitored channels
        if (!config.channelsToMonitor.includes(message.channel.id)) return;
        
        // Check if message contains URLs
        const urls = message.content.match(urlRegex);
        if (!urls || urls.length === 0) return;
        
        console.log(`🔗 Found ${urls.length} URL(s) in #${message.channel.name} from ${message.author.username}`);
        
        // Store link in Baserow
        for (const url of urls) {
            await baserowService.storeLink(message, url);
        }
        
        // Add green checkmark reaction to the message
        try {
            await message.react('✅');
            console.log('✅ Added green checkmark reaction');
        } catch (error) {
            console.error('Error adding reaction:', error);
        }
        
    } catch (error) {
        console.error('❌ Error processing message:', error);
    }
});

// Handle reaction events
client.on('messageReactionAdd', async (reaction, user) => {
    try {
        console.log(`🔍 REACTION EVENT: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);
        console.log(`🔍 Message partial: ${reaction.message.partial}, Reaction partial: ${reaction.partial}`);
        
        if (user.bot) return;

        // Fetch partial messages to get full data for old messages
        if (reaction.partial) {
            try {
                console.log(`🔍 Fetching partial reaction...`);
                await reaction.fetch();
                console.log(`✅ Reaction fetched successfully`);
            } catch (error) {
                console.error('Something went wrong when fetching the reaction:', error);
                return;
            }
        }

        if (reaction.message.partial) {
            try {
                console.log(`🔍 Fetching partial message...`);
                await reaction.message.fetch();
                console.log(`✅ Message fetched successfully`);
            } catch (error) {
                console.error('Something went wrong when fetching the message:', error);
                return;
            }
        }
        
        // Handle DM reactions (for unread links command)
        if (!reaction.message.guild) {
            console.log(`🔍 DM reaction detected: ${reaction.emoji.name} on message ${reaction.message.id}`);
            const key = `${reaction.message.id}-${reaction.emoji.name}`;
            console.log(`🔍 Looking for key: ${key}`);
            console.log(`🔍 dmMessageMap has ${dmMessageMap.size} entries`);
            
            if (dmMessageMap.has(key)) {
                const messageId = dmMessageMap.get(key);
                console.log(`🔍 Found mapping: ${key} -> ${messageId}`);
                
                // Handle checkmark for "mark all as read"
                if (reaction.emoji.name === '✅') {
                    const messageIds = dmMessageMap.get(key);
                    if (Array.isArray(messageIds)) {
                        console.log(`🔍 Bulk marking ${messageIds.length} links as read`);
                        let successCount = 0;
                        for (const id of messageIds) {
                            const success = await baserowService.updateReadStatus(id, true);
                            if (success) successCount++;
                        }
                        console.log(`✅ Marked ${successCount}/${messageIds.length} links as read via bulk action`);
                    }
                } else {
                    // Handle individual numbered reactions
                    console.log(`🔍 Attempting to mark single link as read: ${messageId}`);
                    const success = await baserowService.updateReadStatus(messageId, true);
                    if (success) {
                        console.log(`✅ Marked link as read via DM reaction: ${messageId}`);
                    } else {
                        console.log(`❌ Failed to mark link as read: ${messageId}`);
                    }
                }
            } else {
                console.log(`❌ No mapping found for key: ${key}`);
                console.log(`🔍 Available keys:`, Array.from(dmMessageMap.keys()));
            }
            return;
        }

        // Handle channel reactions for marking links as read
        if (!config.channelsToMonitor.includes(reaction.message.channel.id)) return;
        
        // Handle admin deletion with X emoji
        if (reaction.emoji.name === '❌') {
            console.log(`❌ Admin deletion request: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);
            
            // Check if user has admin permissions
            const member = await reaction.message.guild.members.fetch(user.id);
            const hasAdminPerms = await isUserAdmin(member);
            
            // Check if user is the original poster
            const isOriginalPoster = reaction.message.author.id === user.id;
            
            console.log(`🔍 Deletion permission check:`);
            console.log(`   - User: ${user.username} (${user.id})`);
            console.log(`   - Message author: ${reaction.message.author.username} (${reaction.message.author.id})`);
            console.log(`   - Is admin: ${hasAdminPerms}`);
            console.log(`   - Is original poster: ${isOriginalPoster}`);
            
            if (hasAdminPerms) {
                console.log(`✅ Admin ${user.username} can delete any message, proceeding with deletion`);
            } else if (isOriginalPoster) {
                console.log(`✅ Original poster ${user.username} can delete their own message, proceeding with deletion`);
            } else {
                console.log(`❌ User ${user.username} cannot delete message by ${reaction.message.author.username} (not admin, not original poster)`);
                return;
            }
            
            if (hasAdminPerms || isOriginalPoster) {
                try {
                    // Delete from Baserow first
                    const baserowDeleted = await baserowService.deleteLink(reaction.message.id);
                    
                    // Delete the Discord message
                    await reaction.message.delete();
                    
                    const deletionType = hasAdminPerms ? 'admin' : 'self';
                    console.log(`🗑️ Deleted Discord message ${reaction.message.id} by ${deletionType} ${user.username}`);
                    
                    if (baserowDeleted) {
                        console.log(`✅ Successfully deleted message and Baserow entry`);
                    } else {
                        console.log(`⚠️ Message deleted but no Baserow entry found`);
                    }
                    
                } catch (error) {
                    console.error(`❌ Error deleting message: ${error.message}`);
                }
            }
            return;
        }
        
        if (reaction.emoji.name !== '✅') return;
        
        console.log(`Channel reaction: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);

        // Mark link as read in Baserow if reactor is different from original poster
        await baserowService.updateReadStatusFromReaction(reaction.message.id, user.username, true);
        
        // Handle DM reaction removals (for /unread command responses)
        if (!reaction.message.guild) {
            console.log(`🔍 DM reaction removal detected: ${reaction.emoji.name} by ${user.username}`);
            
            const key = `${reaction.message.id}-${reaction.emoji.name}`;
            if (dmMessageMap.has(key)) {
                const messageId = dmMessageMap.get(key);
                console.log(`Found mapping for DM reaction removal: ${key} -> ${messageId}`);
                
                if (reaction.emoji.name === '✅') {
                    // Bulk mark all links as unread and remove all other reactions
                    const messageIds = dmMessageMap.get(key);
                    if (Array.isArray(messageIds)) {
                        console.log(`Bulk marking ${messageIds.length} links as unread`);
                        for (const id of messageIds) {
                            await baserowService.updateReadStatus(id, false);
                        }
                    } else {
                        await baserowService.updateReadStatus(messageIds, false);
                    }
                    
                    // Remove all other reactions from the DM message
                    try {
                        const dmMessage = reaction.message;
                        for (const [emoji, messageReaction] of dmMessage.reactions.cache) {
                            if (emoji !== '✅') {
                                await messageReaction.users.remove(client.user.id);
                                console.log(`Removed ${emoji} reaction from DM`);
                            }
                        }
                    } catch (error) {
                        console.error('Error removing other reactions:', error);
                    }
                } else {
                    // Mark individual link as unread
                    const success = await baserowService.updateReadStatus(messageId, false);
                    if (success) {
                        console.log(`Successfully marked link as unread for message ${messageId}`);
                    }
                }
            }
            return;
        }
        
    } catch (error) {
        console.error('Error handling reaction:', error.message);
    }
});

// Handle reaction removal events
client.on('messageReactionRemove', async (reaction, user) => {
    try {
        if (user.bot) return;
        
        // Fetch partial messages to get full data for old messages
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the reaction:', error);
                return;
            }
        }

        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the message:', error);
                return;
            }
        }
        
        // Only process reactions in monitored channels
        if (!config.channelsToMonitor.includes(reaction.message.channel.id)) return;
        if (reaction.emoji.name !== '✅') return;

        console.log(`Reaction removed: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);

        // Mark link as unread in Baserow if reactor is different from original poster
        await baserowService.updateReadStatusFromReaction(reaction.message.id, user.username, false);
        
    } catch (error) {
        console.error('Error handling reaction removal:', error.message);
    }
});

// Error handling
client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('SIGINT', () => {
    console.log('🛑 Shutting down bot...');
    client.destroy();
    process.exit(0);
});

// Start the bot
client.login(config.token).catch(error => {
    console.error('❌ Failed to login:', error);
    process.exit(1);
});
