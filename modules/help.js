async function sendHelp(sock, sender) {
    await sock.sendMessage(sender, {
        text: `🤖 *Bot Help Menu*\n\n` +
              `📍 *Commands List:*\n\n` +
              `1️⃣ /contact - Contact management commands\n` +
              `   • /contact recent - Show recent contacts\n` +
              `   • /contact stats - Show contact statistics\n` +
              `   • /contact delete <id|all> - Delete contacts\n` +
              `   • /contact search <id> - Search for a contact\n\n` +
              `2️⃣ /help - Show this menu`
    });
}

module.exports = { sendHelp };