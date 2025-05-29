const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CONTACTS_FILE = path.join(__dirname, '..', 'data', 'contacts.json');
const MAX_CONTACTS_STORED = 50;

// Load contacts on startup
let contacts = loadContactsFromFile();

// Utility to load contacts from file
function loadContactsFromFile() {
    try {
        if (!fs.existsSync(CONTACTS_FILE)) {
            fs.mkdirSync(path.dirname(CONTACTS_FILE), { recursive: true });
            fs.writeFileSync(CONTACTS_FILE, '[]');
        }
        const data = fs.readFileSync(CONTACTS_FILE, 'utf8');
        return JSON.parse(data).map(c => ({ ...c, timestamp: new Date(c.timestamp) }));
    } catch (error) {
        console.error('❌ Failed to load contacts:', error);
        return [];
    }
}

// Utility to save contacts to file
function saveContactsToFile() {
    try {
        fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
    } catch (error) {
        console.error('❌ Failed to save contacts:', error);
    }
}

// Add a new contact
function addContact({ name, email, subject, message }) {
    const newContact = {
        id: uuidv4(),
        name,
        email,
        subject,
        message,
        timestamp: new Date()
    };
    contacts.unshift(newContact);
    if (contacts.length > MAX_CONTACTS_STORED) contacts.pop();
    saveContactsToFile();
    return newContact;
}

// Handle WhatsApp /contact commands
async function handleContactCommand(cmd, sock, sender) {
    const parts = cmd.trim().split(/\s+/);
    const subCommand = parts[1];

    switch (subCommand) {
        case 'recent': {
            if (contacts.length === 0) {
                return sock.sendMessage(sender, { text: '📭 No recent contact data found.' });
            }
            const recent = contacts.slice(0, 5).map(c =>
                `🆔 *ID:* ${c.id}\n👤 *Name:* ${c.name}\n📧 *Email:* ${c.email}\n📝 *Subject:* ${c.subject || 'N/A'}\n💬 *Message:* ${c.message}\n🕒 *Time:* ${c.timestamp.toLocaleString()}`
            ).join('\n\n');
            return sock.sendMessage(sender, { text: `📥 *Recent Contacts*\n\n${recent}` });
        }

        case 'stats': {
            const total = contacts.length;
            const last = contacts[0]?.timestamp?.toLocaleString() || 'None';
            return sock.sendMessage(sender, {
                text: `📊 *Contact Stats*\n\n• Total Contacts: ${total}\n• Last Entry: ${last}`
            });
        }

        case 'delete': {
            if (parts.length < 3) {
                return sock.sendMessage(sender, { text: '❌ *Usage:* /contact delete <id|all>' });
            }
            const idToDelete = parts[2];
            if (idToDelete === 'all') {
                const count = contacts.length;
                contacts = [];
                saveContactsToFile();
                return sock.sendMessage(sender, { text: `✅ All contacts deleted (${count} removed)` });
            }
            const index = contacts.findIndex(c => c.id === idToDelete);
            if (index === -1) {
                return sock.sendMessage(sender, { text: `❌ Contact with ID *${idToDelete}* not found.` });
            }
            const removed = contacts.splice(index, 1)[0];
            saveContactsToFile();
            return sock.sendMessage(sender, {
                text: `🗑️ *Contact Deleted*\n\n🆔 *ID:* ${removed.id}\n👤 *Name:* ${removed.name}\n📧 *Email:* ${removed.email}`
            });
        }

        case 'search': {
            if (parts.length < 3) {
                return sock.sendMessage(sender, { text: '❌ *Usage:* /contact search <id>' });
            }
            const idToSearch = parts[2];
            const found = contacts.find(c => c.id === idToSearch);
            if (!found) {
                return sock.sendMessage(sender, { text: `🔍 Contact with ID *${idToSearch}* not found.` });
            }
            return sock.sendMessage(sender, {
                text: `🔍 *Contact Found*\n\n🆔 *ID:* ${found.id}\n👤 *Name:* ${found.name}\n📧 *Email:* ${found.email}\n📝 *Subject:* ${found.subject || 'N/A'}\n💬 *Message:* ${found.message}\n🕒 *Time:* ${found.timestamp.toLocaleString()}`
            });
        }

        default:
            return sock.sendMessage(sender, {
                text: `📋 *Contact Command Menu*\n\n• /contact recent — Show last 5 contacts\n• /contact stats — Contact statistics\n• /contact delete <id|all> — Delete specific or all contacts\n• /contact search <id> — Search contact by ID`
            });
    }
}

module.exports = {
    addContact,
    handleContactCommand
};
