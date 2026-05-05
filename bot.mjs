import 'dotenv/config';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion, downloadContentFromMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import cors from 'cors';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import express from 'express';
import fs from 'fs';
import pino from 'pino';
import QRCode from 'qrcode';
import PQueue from 'p-queue';
import path from 'path';
import { fileURLToPath } from 'url';

// ==================== ULTRA ANTI-CRASH SYSTEM ====================
process.on('uncaughtException', (err) => console.log(`[ANTI-CRASH] Ignored: ${err.message}`));
process.on('unhandledRejection', (reason) => {});
process.on('warning', (warning) => console.warn('[WARNING]', warning.message));
process.setMaxListeners(0);

// ==================== LOG STREAM (UI) ====================
const logEmitter = new EventEmitter();
const logBuffer = [];
const MAX_LOG_LINES = 200;

function safeToString(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
}

function formatLogArgs(args) {
    return args.map(safeToString).join(' ');
}

function emitLog(level, args) {
    const line = `${new Date().toISOString()} [${String(level).toUpperCase()}] ${formatLogArgs(args)}`;
    logBuffer.push(line);
    if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
    logEmitter.emit('log', line);
}

const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

console.log = (...args) => { originalConsole.log(...args); emitLog('log', args); };
console.warn = (...args) => { originalConsole.warn(...args); emitLog('warn', args); };
console.error = (...args) => { originalConsole.error(...args); emitLog('error', args); };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== CYBER EXOTIC ENGINE ====================
const HSEE = {
    attackQueue: new PQueue({ concurrency: 50, interval: 50, intervalCap: 50 }),
    normalQueue: new PQueue({ concurrency: 20, interval: 50, intervalCap: 20 }),
    async runAttack(task) { try { return await this.attackQueue.add(task); } catch (e) { return null; } },
    async runNormal(task) { try { return await this.normalQueue.add(task); } catch (e) { return null; } },
    clearAll() { 
        this.attackQueue.clear(); 
        this.normalQueue.clear(); 
    }
};

// ==================== SMART STYLISH FONT ENGINE ====================
const fontMap = {
    'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇', 'I': '𝐈', 'J': '𝐉', 'K': '𝐊', 'L': '𝐋', 'M': '𝐌', 'N': '𝐍', 'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓', 'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙',
    'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ғ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ', 's': 's', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ'
};
function styleText(text) {
    if (!text) return text;
    return text.replace(/[a-zA-Z]/g, c => fontMap[c] || c);
}

// ==================== GLOBAL CONFIG & DATABASE ====================
const ROLES_FILE = './data/roles.json';
const BOTS_FILE = './data/bots.json';
const CONFIG_FILE = './data/config.json';
const defaultRoles = { admins: [], subAdmins: [] };
const defaultConfig = { prefix: '!', uiUsername: 'admin', uiPassword: 'change-me', uiOrigin: '*', uiPort: 8787 };

function safeReadJSON(path, def) { try { if (fs.existsSync(path)) return JSON.parse(fs.readFileSync(path, 'utf8')); } catch (e) {} return def; }
function safeWriteJSON(path, data) { try { if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true }); fs.writeFileSync(path, JSON.stringify(data, null, 2)); } catch (e) {} }

let roles = safeReadJSON(ROLES_FILE, defaultRoles);
let globalConfig = { ...defaultConfig, ...safeReadJSON(CONFIG_FILE, defaultConfig) };
let GLOBAL_PREFIX = globalConfig.prefix || defaultConfig.prefix;

function updateConfig(partial) { globalConfig = { ...globalConfig, ...partial }; safeWriteJSON(CONFIG_FILE, globalConfig); }
function updatePrefix(newPrefix) { GLOBAL_PREFIX = newPrefix; updateConfig({ prefix: newPrefix }); }
function getUiUsername() { return process.env.UI_USERNAME || globalConfig.uiUsername || defaultConfig.uiUsername; }
function getUiPassword() { return process.env.UI_PASSWORD || globalConfig.uiPassword || defaultConfig.uiPassword; }
function getUiOrigin() { return process.env.UI_ORIGIN || globalConfig.uiOrigin || defaultConfig.uiOrigin; }
function normalizeJid(jid) {
    if (!jid) return '';

    // 🔥 LID FIX (main issue)
    if (jid.includes('@lid')) {
        return jid.split('@')[0] + '@s.whatsapp.net';
    }

    if (jid.includes(':')) {
        return jid.split(':')[0] + '@s.whatsapp.net';
    }

    if (!jid.includes('@')) {
        return jid + '@s.whatsapp.net';
    }

    return jid;
}
const isAdmin = (jid) => roles.admins.some(a => normalizeJid(a) === normalizeJid(jid));
const isSubAdmin = (jid) => roles.subAdmins.some(s => normalizeJid(s) === normalizeJid(jid));
const hasPerm = (jid) => isAdmin(jid) || isSubAdmin(jid);

// ==================== FULL EMOJI ARRAYS ====================
const emojiArrays = {
    n1:['🔥','💥','⚡','🌪️','🌈','☄️','💫','🌊','❄️','🌸','💀','☠️','👺','🔱','⚜️','🌟','✨','💢','💤','💨','💦','🌀','🌙'], n2:['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','☁️','🌨️','🌧️','🌩️','⛈️','🌦️','🌥️','⛅','🌤️','☀️'], n3:['🛑','🚧','🚨','⛽','🛢️','⚓','📫','📪','📬','📭','📧','💌','✉️','📨','📩','📥','📤'], n4:['📒','📔','📕','📓','📗','📘','📙','🖌️','🖍️','🖊️','🖋️','✒️','✏️'], n5:['🕛','🕧','🕐','🕜','🕑','🕝','🕒','🕞','🕓','🕟','🕔','🕠','🕕','🕡','🕖','🕢','🕗','🕣','🕘','🕤','🕙','🕥','🕚','🕦'], n6:['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','🩷','🩵','🩶','♥️'], n7:['💟','⚛️','🛐','🕉️','☸️','☮️','☯️','☪️','🪯','✝️','☦️','✡️','🔯','🕎','🆔','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','⛎'], n8:['💐','🌹','🥀','🌺','🌷','🪷','🌸','💮','🏵️','🪻','🌻','🌼','🍂','🍁','🍄','🌾','🌿','🌱','🍃','☘️','🍀','🌵','🌴','🪾','🌳','🌲'], n9:['🦅','🕊️','🦢','🪿','🦆','🐦‍🔥','🦃','⚽','⚾','🥎','🏀','🏐','🏈','🏉'], n10:['🦈','🐬','🐋','🐳','🐟','🐠','🐡','🦐','🦞','🦀','🦑','🐙','🪼','🪼','🦪','🪸','🫧'], n11:['🚀','✈️','🛫','🛬','🛩️','🕋','🏙️','🌆','🌇','🌃','🌉','🌁','🗾','🗺️'], n12:['🔮','🧿','🪬','📿','🏺','⚱️','⚰️','🪦','🚬','💣','🪤','📜','⚔️','🗡️','🛡️','🗝️','🔑','🔐','🔏','🔒','🔓'], n13:['🪓','🪝','🧲','🗜️','🔩','🪛','🪚','🔧','🔨','🛠️','⚒️','⛏️','🪏','⚙️','⛓️‍💥','🔗','⛓️','📎','🖇️','✂️','📏','📐'], n14:['◼️','◾','▪️','🔳','🔲','◻️','◽','▫️','🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪']
};
const globalEmojiList = Object.values(emojiArrays).flat();

// ==================== TARGET MESSAGES ====================
const targetMessages = [
    "Chal Tmkb Me Ghuss Ke Nanga Nachh Kruuu 🦈🦈", "🔥ꪻꫀ᥅ﺃ ꪑꪖꪖ ꪗꪖꫝꪖ ᥴꪊᦔꪻﺃ ꫝꫀꫀ 💢", "🧬Tmkc random 🤢🤢🖕🏻🖕🏻🖕🏻🧬", 
    "𝘼𝙒𝘼𝙕 𝙉𝙄𝘾𝙃𝙀 𝙍𝙔𝙉𝘿𝙔 𝙆𝙀 𝘽𝘾𝘾𝐇𝐄 🗞️🗞️", "", "Itna codunga ki 10 din tak tryma hag bhi nhi payegi rndice 🤢🤢🔥🔥🔥", 
    "(👑) 𝐁𝐎𝐋 HARSH 𝐁𝐇𝐀𝐆𝐖𝐀𝐍 𝐊𝐈 𝐉𝐀𝐈 𝐇𝐎 (👑)", "🔥Likhna sikh low lvl rndy ᛕꪊꪻꪻﺃ ᛕꫀꫀ ᜣﺃꪶꪶꫀ ꪻ</tool_call>ᛕᥴ 🤢👞👞🔥"
];

// 🛡️ MEMORY CACHE
const store = {
    messages: {},
    bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                const jid = msg.key.remoteJid;
                if (!this.messages[jid]) this.messages[jid] = {};
                this.messages[jid][msg.key.id] = msg;
                const keys = Object.keys(this.messages[jid]);
                if (keys.length > 50) delete this.messages[jid][keys[0]]; 
            }
        });
    }
};

const qrCache = new Map();

// ==================== BOT SESSION CORE ====================
class BotSession {
    constructor(botId, phone, manager, useQR = false) {
        this.displayId = botId === 'Bot_1' ? '𝐒𝐔𝐏𝐄𝐑 𝐁𝐎𝐓' : botId.replace('Bot_', '𝐁𝐎𝐓 ');
        this.internalId = botId;
        this.phoneNumber = phone;
        this.manager = manager;
        this.useQR = useQR;
        this.authPath = `./auth/${botId}`;
        this.sock = null;
        this.connected = false;
        this.isSuppressed = false; 
        this.shouldReconnect = true;
        this.connecting = false;
        
        // Active Tasks
        this.activeName = new Map();
        this.activeSpam = new Map();
        this.activeSpamFast = new Map();
        this.activePfp = new Map(); 
        this.activeTarget = new Map();
        this.activeSlide = new Map();
        this.activeTagall = new Map();
        this.activeAutoReply = new Map();
        this.activeTargetReply = new Map();
        this.activePcspm = new Map();
        this.activeStspm = new Map();
        this.activeReplyAll = new Map();
        this.activeDesc = new Map();
        this.activeTxt = new Map(); 

        this.autoReactEmoji = null;
    }

    async connect() {
        if (this.connecting) return;
        this.connecting = true;
        this.shouldReconnect = true;

        try {
            if (!fs.existsSync(this.authPath)) fs.mkdirSync(this.authPath, { recursive: true });
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                auth: state,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                mobile: false,
                browser: ["Ubuntu", "Chrome", "20.0.04"],
                syncFullHistory: false,
                getMessage: async (key) => {
                    if (store) {
                        const msg = store.messages[key.remoteJid]?.[key.id];
                        return msg?.message || undefined;
                    }
                    return { conversation: `*${styleText("(⚡) [ Semiquantum Technologies ] (⚡)")}*` };
                }
            });

            store.bind?.(this.sock.ev);
            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('call', async (calls) => {
                for (const call of calls) {
                    if (call.status === 'offer') {
                        try { await this.sock.rejectCall(call.id, call.from); } catch (err) {}
                    }
                }
            });

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && this.useQR) {
                    try {
                        const dataUrl = await QRCode.toDataURL(qr);
                        qrCache.set(this.internalId, { dataUrl, ts: Date.now() });
                        console.log(`[${this.displayId}] QR updated for UI`);
                    } catch (err) {}
                }

                if (connection === 'close') {
                    this.connected = false;
                    const code = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 500;
                    if (this.shouldReconnect && code !== DisconnectReason.loggedOut && code !== 401) {
                        setTimeout(() => this.connect(), 5000);
                    } else if (code === DisconnectReason.loggedOut || code === 401) {
                        if (fs.existsSync(this.authPath)) fs.rmSync(this.authPath, { recursive: true, force: true });
                    }
                } else if (connection === 'open') {
                    this.connected = true;
                    qrCache.delete(this.internalId);
                    console.log(`[${this.displayId}] ONLINE AND READY`);
                }
            });

            this.sock.ev.on('messages.upsert', m => this.handleMsg(m));
        } finally {
            this.connecting = false;
        }
    }

    async stop({ logout = false } = {}) {
        this.shouldReconnect = false;
        try {
            if (logout && this.sock?.logout) {
                await this.sock.logout();
            } else if (this.sock?.end) {
                this.sock.end();
            } else if (this.sock?.ws?.close) {
                this.sock.ws.close();
            }
        } catch (err) {}
        this.connected = false;
    }

    async send(jid, text, mentions = [], quoted = null, imageUrl = null) {
        if (!this.connected) return;
        const styledText = styleText(text); 
        const finalStyledText = `*${styledText}*`; 
        let msgPayload = { text: finalStyledText, mentions: mentions.length ? mentions : undefined };
        if (imageUrl && fs.existsSync(imageUrl)) {
            msgPayload = { image: fs.readFileSync(imageUrl), caption: finalStyledText, mentions: mentions.length ? mentions : undefined };
        }
        await this.sock.sendMessage(jid, msgPayload, quoted ? { quoted } : {}).catch(()=>{});
    }

    async ping(from) {
        const start = Date.now();
        await this.send(from, `(⚡) [ Semiquantum Technologies Speed Check... ] (⚡)`);
        await this.send(from, `(🚀) [ Latency: ${Date.now() - start}ms ] (🚀)`);
    }

    async handleMsg({ messages, type }) {
       
        console.log("📩 MESSAGE EVENT:", JSON.stringify(messages[0]?.key));
    
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJidAlt || msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
       const sender = normalizeJid(
    msg.key.participantAlt || 
    msg.key.participant || 
    msg.key.remoteJidAlt || 
    from
);

      const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    "";
    console.log("📨 TEXT:", text);
    const isCmd = text && text.startsWith(GLOBAL_PREFIX);
        let command = "";
if (text && text.startsWith("!")) {
    command = text.slice(1).trim().split(" ")[0].toLowerCase();
}
        const args = text.split(/ +/).slice(1);
        const quotedMsg = msg.message.extendedTextMessage?.contextInfo;
        const mentioned = quotedMsg?.mentionedJid || [];
        const isMain = this.internalId === this.manager.getMainBotId();
        const replyJid = quotedMsg?.participant ? normalizeJid(quotedMsg.participant) : null;
if (text === "!ping") {
    const replyTo = msg.key.remoteJidAlt || msg.key.remoteJid;

    await this.sock.sendMessage(replyTo, {
        text: "PONG FINAL WORKING ✅"
    });
}
        // Auto React Engine
        if (this.autoReactEmoji && !isCmd && !this.isSuppressed) {
            const safeReactDelay = Math.floor(Math.random() * (4000 - 1500 + 1)) + 1500;
            setTimeout(() => { this.sock.sendMessage(from, { react: { text: this.autoReactEmoji, key: msg.key } }).catch(() => {}); }, safeReactDelay);
        }

        // ==================== DYNAMIC ADMIN LOGIC (Max 2 Slots) ====================
        if (isCmd && command === 'admin') {
            const normSender = normalizeJid(sender);
            
            // 1. Agar sender pehle se admin hai
            if (isAdmin(normSender)) {
                // Wo kisi aur ko tag/reply karke admin bana raha hai
                if (replyJid) {
                    if (roles.admins.length >= 2) {
                        await this.send(from, `(❌) [ Admin slots full hain (Max 2 allowed)! ]`);
                        return;
                    }
                    if (!roles.admins.includes(replyJid)) {
                        roles.admins.push(replyJid);
                        safeWriteJSON(ROLES_FILE, roles);
                        await this.send(from, `👑 @${replyJid.split('@')[0]} is now an Admin!\n📊 Slots used: ${roles.admins.length}/2`, [replyJid]);
                    }
                } else {
                    await this.send(from, `(✅) [ Bhai tu pehle se hi Admin hai! ]`);
                }
                return; 
            }

            // 2. Agar sender admin NAHI hai aur khud claim karna chahta hai
            if (roles.admins.length >= 2) {
                await this.send(from, `(❌) [ Admin slots full hain. (Max 2 allowed) ]`);
                return;
            }
            
            // Slot khali hai, naye bande ko admin de do
            roles.admins.push(normSender);
            safeWriteJSON(ROLES_FILE, roles);
            await this.send(from, `👑 ADMIN ACCESS CLAIMED BY @${normSender.split('@')[0]}\n📊 Slots used: ${roles.admins.length}/2`, [normSender]);
            return;
        }

        // Task Execution Blocks
        if (!this.isSuppressed) {
            if (isGroup && this.activeTargetReply.has(`${from}_${sender}`)) {
                const slideTask = this.activeTargetReply.get(`${from}_${sender}`);
                if (slideTask.active) {
                    HSEE.runAttack(async () => {
                        if (!this.activeTargetReply.has(`${from}_${sender}`)) return;
                        await this.send(from, slideTask.text, [], msg);
                    });
                }
            }

            if (isGroup && this.activeAutoReply.has(`${from}_autoreply`)) {
                const task = this.activeAutoReply.get(`${from}_autoreply`);
                if (task.active && (task.targets.length === 0 || task.targets.includes(normalizeJid(sender)))) {
                    if (isMain) {
                        HSEE.runAttack(async () => {
                            if (!this.activeAutoReply.has(`${from}_autoreply`)) return;
                            await this.send(from, "(⚡) [ Semiquantum Technologies ACTIVE ] (⚡)", [sender], msg);
                        });
                    }
                }
            }

            if (this.activeTarget.has(`${from}_target`)) {
                const task = this.activeTarget.get(`${from}_target`);
                if (task.targets.includes(normalizeJid(sender))) {
                    HSEE.runAttack(async () => {
                        if (!this.activeTarget.has(`${from}_target`)) return;
                        const spamMsg = targetMessages[Math.floor(Math.random() * targetMessages.length)];
                        await this.send(from, spamMsg, [sender], msg); 
                    });
                }
            }
            
            if (isGroup && this.activeReplyAll.has(from)) {
                const task = this.activeReplyAll.get(from);
                HSEE.runAttack(async () => {
                    if (!this.activeReplyAll.has(from)) return;
                    await this.send(from, task.text, [], msg);
                });
            }
        }

        // Global Command Router
        if (isMain && !isGroup && hasPerm(sender)) {
            if (text.startsWith('global ')) {
                const subCmdText = text.replace('global ', '').trim();
                const subCmd = subCmdText.split(' ')[0].toLowerCase();
                const subArgs = subCmdText.split(' ').slice(1);
                this.manager.bots.forEach(bot => bot.executeInternal(from, subCmd, sender, msg, subArgs, quotedMsg, bot.internalId === this.manager.getMainBotId()));
                return;
            }
        }

        // Standard Command Execution (Only for Admins/SubAdmins)
       if (isCmd) {
            if (this.isSuppressed && command !== 'uplift') return; 
            if (!isMain) this.sock.sendMessage(from, { react: { text: '⚡', key: msg.key } }).catch(()=>{});
            this.executeInternal(from, command, sender, msg, args, quotedMsg, isMain);
        }
    }

    async executeInternal(from, command, sender, msg, args, quotedMsg, isMain) {
        const replyJid = quotedMsg?.participant ? normalizeJid(quotedMsg.participant) : null;
        const mentioned = quotedMsg?.mentionedJid || [];
        const isGroup = from.endsWith('@g.us');
        const allowGlobal = !isGroup && isMain;

        switch (command) {
            case 'menu':
                if (!isMain) return;
                const menuTxt = `
⛩️  HARSH   ⛩️
   『 SEMIQUANTUM TECHNOLOGIES 𝐄𝐃𝐈𝐓𝐈𝐎𝐍 』

╭╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╮
   ⚡ 𝐌𝐀𝐈𝐍 𝐅𝐑𝐀𝐌𝐄 / 𝐒𝐘𝐒𝐓𝐄𝐌
╰╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╯
  💠 !status 𖦹 System Health
  💠 !addbot 𖦹 Deploy Node
  💠 !pre / !ping 𖦹 Config
  💠 !wipe / !clear 𖦹 Purge Cache

╭╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╮
   🩸 𝐒𝐏𝐀𝐌  𝐃𝐄𝐒𝐓𝐑𝐔𝐂𝐓𝐈𝐎𝐍
╰╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╯
  🧬 !name 𖦹 Subject Turbo
  🧬 !spam 𖦹 Custom Loop
  🧬 !spamfast 𖦹 Rapid Fire
  🧬 !dtx / !pcspm 𖦹 Media Hit

╭╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╮
   🎯 𝐓𝐀𝐑𝐆𝐄𝐓  𝐇𝐄𝐗𝐄𝐒
╰╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╯
  💀 !target 𖦹 Fix Enemy
  💀 !slide / !s 𖦹 Reply Hunt
  💀 !gcpfp / !desc 𖦹 GC Flash
  💀 !kickall 𖦹 GC Purge

╭╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╮
   🛑 𝐊𝐈𝐋𝐋  𝐒𝐖𝐈𝐓𝐂𝐇𝐄𝐒
╰╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╾╼╯
  ✖️ !stopall 𖦹 Stop GC Bot
  ✖️ !globalstop 𖦹 Kill Nodes
  ✖️ !stopspam 𖦹 End Loop

    ⚡ 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 SEMIQUANTUM TECHNOLOGIES ⚡`;
                await this.send(from, menuTxt); 
                break;

            case 'addbot':
                if (!isMain) return;
                const phone = args[0]?.replace(/\D/g, '');
                if (!phone) return await this.send(from, `(❌) Usage: ${GLOBAL_PREFIX}addbot 91XXXXXXXXXX`);

                this.manager.counter++; 
                const newId = `Bot_${this.manager.counter}`;
                await this.send(from, `(⏳) [ Initializing ${newId.replace('_', ' ')}... ]`);

                const newSession = new BotSession(newId, phone, this.manager, false);
                this.manager.bots.set(newId, newSession);
                await newSession.connect();

                setTimeout(async () => {
                    try {
                        const code = await newSession.sock.requestPairingCode(phone);
                        await this.send(from, `
╔════════════════════════╗
    🛰️  𝐍𝐎𝐃𝐄  𝐀𝐂𝐓𝐈𝐕𝐀𝐓𝐄𝐃
╚════════════════════════╝
┃ 🆔 𝐍𝐚𝐦𝐞: ${newId.replace('_', ' ')}
┃ 📱 𝐍𝐮𝐦: ${phone}
┃ 🔑 𝐂𝐨𝐝𝐞: *${code}*
╚════════════════════════╝`);
                        this.manager.save();
                    } catch(e) { await this.send(from, `(❌) Error: ${e.message}`); }
                }, 5000);
                break;

            case 'status':
                if (!isMain) return;
                const ramUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
                const upseconds = process.uptime();
                const hours = Math.floor(upseconds / 3600);
                const minutes = Math.floor((upseconds % 3600) / 60);
                const mainId = this.manager.getMainBotId();

                const botList = [...this.manager.bots.values()].map(b => {
                    const isCurrentMain = b.internalId === mainId;
                    const icon = b.connected ? '🟢' : '🔴';
                    const role = isCurrentMain ? '『 👑 𝐌𝐀𝐈𝐍 』' : '『 🛰️ 𝐍𝐎𝐃𝐄 』';
                    const supStatus = b.isSuppressed ? '[🔇 SUPPRESSED]' : '';
                    let action = "Idle 💤";
                    if (b.activeSpamFast.size > 0 || b.activeName.size > 0 || b.activeSpam.size > 0 || b.activeTarget.size > 0 || b.activePfp.size > 0 || b.activeDesc.size > 0) action = "Attacking 🩸";
                    return `┃ ${icon} *${b.displayId}* ➔ ${action} ${supStatus}\n┃    └─ ${role}`;
                }).join('\n');

                const statusBody = `
┏━━━━━━━━━━━━━━━━━━━━━━━━┓
      📊  HARSH   𝐃𝐀𝐒𝐇𝐁𝐎𝐀𝐑𝐃  
┗━━━━━━━━━━━━━━━━━━━━━━━━┛
┃ 🛰️  𝐍𝐎𝐃𝐄𝐒  𝐂𝐎𝐍𝐓𝐑𝐎𝐋:
${botList}
┣━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 🖥️  𝐒𝐘𝐒𝐓𝐄𝐌  𝐇𝐄𝐀𝐋𝐓𝐇:
┃ 🔹 RAM Load: ${ramUsed} MB
┃ 🔹 Runtime: ${hours}h ${minutes}m
┃ 🔹 Engine: SEMIQUANTUM  V3.6
┗━━━━━━━━━━━━━━━━━━━━━━━━┛`;
                await this.send(from, statusBody);
                break;

           case 'ping':
    await this.send(from, "PONG ✅");
    break;
            case 'pre':
                if (!isMain) return;
                if (args.length === 0) return await this.send(from, `(⚠️) [ Use: ${GLOBAL_PREFIX}pre <new_prefix> ]`);
                updatePrefix(args[0]);
                await this.send(from, `(⚙️) [ PREFIX UPDATED TO: ${args[0]} ]`);
                break;

            case 'clear':
                if (!isMain) return;
                let clearedItems = 0;
                if (store.messages[from]) { delete store.messages[from]; clearedItems++; }
                await this.send(from, clearedItems > 0 ? `(🧹) [ Cache Cleared! ]` : `(⚠️) [ Cache already empty. ]`);
                break;

            case 'rmadmin':
            case 'removeadmin':
                if (!isAdmin(sender) || !isMain) return;
                const targetsAdmin = mentioned.length > 0 ? mentioned : (replyJid ? [replyJid] : []);
                if (targetsAdmin.length === 0) return await this.send(from, `(❌) [ Tag kar jise Admin list se ukhad fekna hai! ]`);
                targetsAdmin.forEach(jid => {
                    let normJid = normalizeJid(jid);
                    if (normJid === normalizeJid(sender)) return; 
                    roles.admins = roles.admins.filter(a => a !== normJid);
                });
                safeWriteJSON(ROLES_FILE, roles);
                await this.send(from, `(💀) [ Admin(s) Terminated! ]`);
                break;

            case 'sub':
                if (!replyJid || !isAdmin(sender) || !isMain) return;
                if (!roles.subAdmins.includes(replyJid)) {
                    roles.subAdmins.push(replyJid); safeWriteJSON(ROLES_FILE, roles);
                    await this.send(from, `🔰 @${replyJid.split('@')[0]} is now Sub-Admin!`, [replyJid]);
                }
                break;

            case 'rmsub':
                if (!replyJid || !isAdmin(sender) || !isMain) return;
                roles.subAdmins = roles.subAdmins.filter(s => s !== replyJid); safeWriteJSON(ROLES_FILE, roles);
                await this.send(from, `🗑️ Removed @${replyJid.split('@')[0]} from Sub-Admins`, [replyJid]);
                break;

            case 'sup':
                if (!isMain) return;
                const targetSup = args[0] ? `Bot_${args[0]}` : this.internalId;
                const botToSup = this.manager.bots.get(targetSup);
                if (botToSup) { botToSup.isSuppressed = true; await this.send(from, `(🔇) [ ${botToSup.displayId} is now Suppressed! ]`); }
                break;

            case 'uplift':
                if (!isMain) return;
                const targetLift = args[0] ? `Bot_${args[0]}` : this.internalId;
                const botToLift = this.manager.bots.get(targetLift);
                if (botToLift) { botToLift.isSuppressed = false; await this.send(from, `(🔊) [ ${botToLift.displayId} is now Active! ]`); }
                break;

            case 'auto':
                this.autoReactEmoji = args[0] || '🔥';
                if (isMain) await this.send(from, `✅ Auto-React Set for ${this.displayId}: ${this.autoReactEmoji}`);
                break;

            case 'kickall':
                if (isGroup && isMain) {
                    const meta = await this.sock.groupMetadata(from);
                    const targets = meta.participants.filter(p => p.admin !== 'admin' && p.admin !== 'superadmin').map(p => p.id);
                    await this.send(from, `(🧹) [ Purging members... ]`);
                    for (let i=0; i<targets.length; i+=5) { await this.sock.groupParticipantsUpdate(from, targets.slice(i, i+5), 'remove').catch(()=>{}); await delay(2000); }
                }
                break;

            case 'tagall':
                if (isGroup && isMain) {
                    const meta = await this.sock.groupMetadata(from);
                    const participants = meta.participants.map(p => p.id);
                    const id = `${from}_tagall`; this.activeTagall.set(id, { active: true });
                    (async () => { for(let i=0; i<5 && this.activeTagall.has(id) && this.connected; i++) { await this.send(from, `(📢) [ DEV X TAG ]\n` + participants.map(p => `@${p.split('@')[0]}`).join(' '), participants); await delay(2000); } this.activeTagall.delete(id); })();
                }
                break;

            case 'dele':
                const qDele = msg.message.extendedTextMessage?.contextInfo;
                if (qDele?.stanzaId) await this.sock.sendMessage(from, { delete: { remoteJid: from, fromMe: true, id: qDele.stanzaId } }).catch(()=>{});
                break;

            case 'pin': // Executing safe delay pin
                const qPin = msg.message.extendedTextMessage?.contextInfo;
                if (qPin?.stanzaId) {
                    await delay(2000); // Requested safe delay
                    await this.sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: qPin.stanzaId, participant: qPin.participant } }).catch(()=>{});
                }
                break;

            case 'deleall':
                if (store.messages[from]) {
                    const botMsgs = Object.values(store.messages[from]).filter(m => m.key.fromMe === true);
                    for (const m of botMsgs) { await this.sock.sendMessage(from, { delete: m.key }).catch(()=>{}); await delay(300); }
                }
                break;
                
            case 'leave':
                if (isGroup && isMain) {
                    await this.send(from, `(👋) [ HARSH BHAGWAN IS LEAVING THE MATRIX! ]`);
                    await delay(1000);
                    await this.sock.groupLeave(from).catch(()=>{});
                }
                break;

            case 'gcpfp':
                if (!isGroup) return;
                const quotedPfp = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!quotedPfp) return isMain && await this.send(from, "(⚠️) [ Photo par reply karke command do! ]");
                
                const pfpLoopId = `pfp_${msg.message.extendedTextMessage.contextInfo.stanzaId}`;
                if (this.activePfp.has(pfpLoopId)) return;

                try {
                    const stream = await downloadContentFromMessage(quotedPfp, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    this.activePfp.set(pfpLoopId, true);
                    if (isMain) await this.send(from, "(🚀) [ PFP Flash Mode Active! ]");

                    (async () => {
                        while (this.activePfp.has(pfpLoopId) && this.connected) {
                            await this.sock.updateProfilePicture(from, buffer).catch(() => {});
                            await delay(Math.floor(Math.random() * 4000) + 5000);
                        }
                    })();
                } catch (e) { console.log("PFP Error"); }
                break;

            case 'stoppfp':
                for (let key of this.activePfp.keys()) { if (key.startsWith('pfp_')) this.activePfp.delete(key); }
                if (isMain) await this.send(from, "stoppfp ➣ PFP Loops Terminated!");
                break;

            case 'target':
                const targets = mentioned.length > 0 ? mentioned : (replyJid ? [replyJid] : []);
                if (targets.length > 0) {
                    this.activeTarget.set(`${from}_target`, { targets: targets.map(normalizeJid) });
                    if (isMain) await this.send(from, "🎯 Targets Locked! Active.");
                } else {
                    if (isMain) await this.send(from, "❌ Please reply or tag someone to target!");
                }
                break;

            case 'slide':
                const slideText = args.join(" ");
                if (!replyJid) return isMain && await this.send(from, `(⚠️) [ Reply to target! ]`);
                if (!slideText) return isMain && await this.send(from, `(⚠️) [ Enter message! ]`);
                this.activeTargetReply.set(`${from}_${replyJid}`, { active: true, text: slideText });
                if (isMain) await this.send(from, `(✅) [ Target Locked for Slide! ]`);
                break;

            case 'autoreply':
                if (isGroup) { this.activeAutoReply.set(`${from}_autoreply`, { active: true, targets: mentioned.map(normalizeJid) }); if (isMain) await this.send(from, `(⚡) [ Auto-Reply Active! ]`); }
                break;
                
            case 'replyall':
                if (isGroup) {
                    const rText = args.join(" ");
                    if (!rText) return isMain && await this.send(from, "(⚠️) Text toh daal bhai!");
                    this.activeReplyAll.set(from, { active: true, text: rText });
                    if (isMain) await this.send(from, "🔄 Reply-All Active!");
                }
                break;

            case 'desc':
                if (!isGroup) return;
                const baseDescText = args.join(" ") || "𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 SEMIQUANTUM TECHNOLOGIES";
                if (this.activeDesc.has(from)) return;
                
                this.activeDesc.set(from, true);
                if (isMain) await this.send(from, "📝 Group Description Flash Spam Started!");

                (async () => {
                    const allDescEmojis = Object.values(emojiArrays).flat();
                    while (this.activeDesc.has(from) && this.connected) {
                        const randomEmoji = allDescEmojis[Math.floor(Math.random() * allDescEmojis.length)];
                        const newDesc = styleText(`${baseDescText} ${randomEmoji}`);

                        await HSEE.runAttack(async () => {
                            if (!this.activeDesc.has(from)) return;
                            await this.sock.groupUpdateDescription(from, newDesc).catch(()=>{});
                        });
                        
                        await delay(Math.floor(Math.random() * 1500) + 1500); 
                    }
                })();
                break;

            // ==================== NEW SPAM ARTS ====================
case 'name':
    const nameTaskKey = `${from}_name`;
    if (this.activeName.has(nameTaskKey)) return;

    let nameDelay = 5000; // default 5 sec
    let nameText = "HARSH";

    // ✅ args parse (last arg = delay)
    if (args.length > 0) {
        const last = args[args.length - 1].toLowerCase();
        const match = last.match(/^(\d+)(ms|s)?$/);

        if (match) {
            nameDelay = match[2] === 's'
                ? parseInt(match[1]) * 1000
                : parseInt(match[1]);
            args.pop();
        }

        if (args.length > 0) {
            nameText = args.join(" ");
        }
    }

    this.activeName.set(nameTaskKey, true);

    if (isMain) {
        await this.send(from, `⚡ NAME ATTACK STARTED | Delay: ${nameDelay}ms`);
    }

    (async () => {
        while (this.activeName.has(nameTaskKey) && this.connected) {

            await HSEE.runAttack(async () => {
                if (!this.activeName.has(nameTaskKey)) return;

                try {
                    const emojis = ['🔥','⚡','🌪️','🌀','🌙','💀','👺','✨'];
                    const e = emojis[Math.floor(Math.random() * emojis.length)];

                    await this.sock.groupUpdateSubject(
                        from,
                        styleText(`${e} ${nameText} ${e}`)
                    );
                } catch (err) {}
            });

            await delay(nameDelay);
        }
    })();

    break;
            case 'spam':
                const spamMsg = args.join(" ");
                if (!spamMsg) return isMain && this.send(from, "(⚠️) Enter text!");
                this.activeSpam.set(from, true);
                if (isMain) await this.send(from, "(✍️) Spam Active (12s-25s delay with random emojis).");

                (async () => {
                    const allEmojis = globalEmojiList;
                    while (this.activeSpam.has(from) && this.connected) {
                        const emoji1 = allEmojis[Math.floor(Math.random() * allEmojis.length)];
                        const emoji2 = allEmojis[Math.floor(Math.random() * allEmojis.length)];
                        const emojiLine = `${emoji1} ${spamMsg} ${emoji2}`;

                        await HSEE.runAttack(async () => {
                            if (!this.activeSpam.has(from)) return;
                            await this.send(from, emojiLine);
                        });
                        
                        const waitTime = Math.floor(Math.random() * (25000 - 12000 + 1)) + 12000;
                        await delay(waitTime); 
                    }
                })();
                break;

            case 'spamfast':
                const sfTaskKey = `${from}_spamfast`;
                if (this.activeSpamFast.has(sfTaskKey)) return;

                let sfDelay = 2000; // Default 2 seconds
                let sfText = "HARSH ";

                if (args.length > 0) {
                    const match = args[0].toLowerCase().match(/^(\d+)(ms|s)?$/);
                    if (match) {
                        sfDelay = match[2] === 's' ? parseInt(match[1]) * 1000 : parseInt(match[1]);
                        args.shift(); 
                    }
                    if (args.length > 0) sfText = args.join(" ");
                }

                this.activeSpamFast.set(sfTaskKey, true);
                if (isMain) await this.send(from, `(🚀) [ SpamFast Active | Delay: ${sfDelay}ms ]`);

                (async () => {
                    while (this.activeSpamFast.has(sfTaskKey) && this.connected) {
                        const quoteObj = quotedMsg ? { key: { remoteJid: from, id: msg.message.extendedTextMessage.contextInfo.stanzaId, participant: quotedMsg.participant }, message: quotedMsg.quotedMessage } : null;
                        
                        await HSEE.runAttack(async () => {
                            if (!this.activeSpamFast.has(sfTaskKey)) return; 
                            await this.send(from, sfText, [], quoteObj); 
                        });
                        
                        await delay(sfDelay);
                    }
                })();
                break;

            case 'pcspm':
                const imageMsg = quotedMsg?.quotedMessage?.imageMessage || msg.message?.imageMessage;
                if (!imageMsg) return isMain && this.send(from, "(⚠️) Reply to an image!");
                this.activePcspm.set(from, true);
                if (isMain) await this.send(from, "(📸) Image Spam Started...");

                (async () => {
                    const stream = await downloadContentFromMessage(imageMsg, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                    while (this.activePcspm.has(from) && this.connected) {
                        await this.sock.sendMessage(from, { image: buffer }).catch(() => {});
                        await delay(Math.floor(Math.random() * 2500) + 1500); 
                    }
                })();
                break;

            case 'stspm':
                const stickMsg = quotedMsg?.quotedMessage?.stickerMessage;
                if (!stickMsg) return isMain && this.send(from, "(⚠️) Reply to a sticker!");
                this.activeStspm.set(from, true);
                if (isMain) await this.send(from, "(🎭) Sticker Spam Started...");

                (async () => {
                    const stream = await downloadContentFromMessage(stickMsg, 'sticker');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                    while (this.activeStspm.has(from) && this.connected) {
                        await this.sock.sendMessage(from, { sticker: buffer }).catch(() => {});
                        await delay(Math.floor(Math.random() * 2000) + 1500);
                    }
                })();
                break;

            case 'dtx':
                let delayTime = 100; let dtxText = "";
                if (args.length > 0) { const match = args[args.length-1].toLowerCase().match(/^(\d+)(ms|s)?$/); if (match) { delayTime = match[2] === 's' ? parseInt(match[1])*1000 : parseInt(match[1]); args.pop(); } dtxText = args.join(" "); }
                if (dtxText) {
                    const id = `${from}_dtx`; const task = { active: true }; this.activeTxt.set(id, task); 
                    if (isMain) await this.send(from, `(⚙️) [ DTX Active! Delay: ${delayTime}ms ]`);
                    (async () => { 
                        while (this.activeTxt.has(id) && this.connected) { 
                            await HSEE.runAttack(async () => {
                                if (!this.activeTxt.has(id)) return;
                                await this.send(from, dtxText);
                            }); 
                            await delay(nameDelay);
                        } 
                    })();
                }
                break;

            case 's':
                const delayS = parseInt(args.pop()) || 2000; const sSpam = args.join(" ");
                const stanzaId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
                if (sSpam && quotedMsg) {
                    const id = `${from}_slide`; const task = { active: true }; this.activeSlide.set(id, task);
                    const qObj = { key: { remoteJid: from, id: stanzaId, participant: quotedMsg.participant }, message: quotedMsg.quotedMessage };
                    (async () => { 
                        while (this.activeSlide.has(id) && this.connected) { 
                            await HSEE.runNormal(async () => {
                                if (!this.activeSlide.has(id)) return;
                                await this.send(from, sSpam, [], qObj);
                            }); 
                            await delay(delayS); 
                        } 
                    })();
                }
                break;

            case 'wipe':
                if(!isMain) return;
                let wipedCount = 0;
                if (store.messages[from]) { delete store.messages[from]; wipedCount++; }
                HSEE.clearAll();
                await this.send(from, `╔════════════════════════╗\n    🧹 𝐌𝐄𝐌𝐎𝐑𝐘 𝐖𝐈𝐏𝐄𝐃\n╚════════════════════════╝\n┃ 📊 𝐂𝐚𝐜𝐡𝐞: 𝐂𝐥𝐞𝐚𝐧𝐞𝐝\n┃ 🩸 𝐐𝐮𝐞𝐮𝐞𝐬: 𝐑𝐞𝐬𝐞𝐭`);
                break;

            // ==================== STOP COMMANDS ====================
            case 'stopall':
                this.activeName.clear(); this.activeSpam.clear(); this.activeSpamFast.clear();
                this.activeTarget.clear(); this.activeSlide.clear(); this.activeTagall.clear();
                this.activeAutoReply.clear(); this.activeTargetReply.clear(); this.activePcspm.clear(); 
                this.activeStspm.clear(); this.activeReplyAll.clear(); this.activeDesc.clear(); this.activeTxt.clear();
                for (let key of this.activePfp.keys()) { if (key.startsWith('pfp_')) this.activePfp.delete(key); }
                this.autoReactEmoji = null;
                HSEE.clearAll(); 
                if (isMain) await this.send(from, `stopall ➣ All Systems Halted for this GC`);
                break;

            case 'stopspamfast': 
                this.activeSpamFast.delete(`${from}_spamfast`); 
                if (isMain) await this.send(from, "stopspamfast ➣ SpamFast Halted"); 
                break;
            case 'stopname': 
                this.activeName.delete(from); 
                if (isMain) await this.send(from, "stopname ➣ Name-Attack Halted"); 
                break;
            case 'stopspam': 
                this.activeSpam.delete(from); 
                if (isMain) await this.send(from, "stopspam ➣ Custom Loop Spam Halted"); 
                break;
            case 'stoppc': 
                this.activePcspm.delete(from); 
                if (isMain) await this.send(from, "stoppc ➣ Photo Spam Halted"); 
                break;
            case 'stopst': 
                this.activeStspm.delete(from); 
                if (isMain) await this.send(from, "stopst ➣ Sticker Spam Halted"); 
                break;
            case 'stoptarget': 
                this.activeTarget.delete(`${from}_target`); 
                if (isMain) await this.send(from, "stoptarget ➣ Release Target"); 
                break;
            case 'stopdtx': 
                this.activeTxt.delete(`${from}_dtx`); 
                if (isMain) await this.send(from, "stopdtx ➣ DTX Stopped"); 
                break;
            case 'stopreplyall':
                this.activeReplyAll.delete(from);
                if (isMain) await this.send(from, "stopreplyall ➣ Reply All Stopped");
                break;
            case 'stopdesc':
                this.activeDesc.delete(from);
                if (isMain) await this.send(from, "stopdesc ➣ Stop Desc Spam");
                break;

            // --- GLOBAL MASTER KILL SWITCHES ---
            case 'globalstop':
                if (!allowGlobal) return;
                this.manager.bots.forEach(bot => {
                    bot.activeName.clear(); bot.activeSpam.clear(); bot.activeSpamFast.clear();
                    bot.activeTarget.clear(); bot.activeSlide.clear(); bot.activeTargetReply.clear();
                    bot.activePcspm.clear(); bot.activeStspm.clear(); bot.activeReplyAll.clear(); 
                    bot.activeDesc.clear(); bot.activeTxt.clear();
                });
                HSEE.clearAll();
                await this.send(from, `globalstop ➣ 𝐆𝐋𝐎𝐁𝐀𝐋 𝐇𝐀𝐋𝐓: 𝐀𝐥𝐥 𝐍𝐨𝐝𝐞𝐬 𝐒𝐭𝐨𝐩𝐩𝐞𝐝`);
                break;
        }
    }
}

// ==================== BOT MANAGER ====================
class BotManager {
    constructor() { this.bots = new Map(); this.counter = 1; }

    async init() {
        const saved = safeReadJSON(BOTS_FILE, { counter: 1, bots: [] });
        this.counter = saved.counter || 1;

        if (saved.bots.length > 0) {
            console.log(`\nRestoring Matrix Fleet (${saved.bots.length} Nodes)...`);
            for (const b of saved.bots) {
                const session = new BotSession(b.id, b.phone, this, true);
                this.bots.set(b.id, session); 
                await session.connect();
                await delay(2000);
            }
        } else {
            console.log('\nNo nodes found. Use the UI to add and pair a bot.');
        }
    }

    getBotStatus() {
        const mainId = this.getMainBotId();
        return [...this.bots.values()].map(b => ({
            id: b.internalId,
            displayId: b.displayId,
            connected: b.connected,
            suppressed: b.isSuppressed,
            useQR: b.useQR,
            phone: b.phoneNumber,
            isMain: b.internalId === mainId
        }));
    }

    async requestPairingCodeWithRetry(session, phone, attempts = 3) {
        let lastError = null;
        for (let i = 0; i < attempts; i++) {
            try {
                await delay(3000 + (i * 2000));
                return await session.sock.requestPairingCode(phone);
            } catch (err) {
                lastError = err;
            }
        }
        if (lastError) throw lastError;
        return null;
    }

    async addBot({ phone, useQR }) {
        const isFirst = this.bots.size === 0;
        const nextId = isFirst ? 'Bot_1' : `Bot_${++this.counter}`;
        const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;

        const session = new BotSession(nextId, cleanPhone, this, !!useQR);
        this.bots.set(nextId, session);
        try {
            await session.connect();
        } catch (err) {
            this.bots.delete(nextId);
            throw err;
        }

        let pairingCode = null;
        let pairingError = null;
        if (!useQR && cleanPhone) {
            try {
                pairingCode = await this.requestPairingCodeWithRetry(session, cleanPhone);
            } catch (err) {
                pairingError = err?.message || 'pairing_failed';
            }
        }

        this.save();
        return { botId: nextId, pairingCode, pairingError };
    }

    async startBot(botId) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error('bot_not_found');
        if (bot.connected) return { ok: true };
        await bot.connect();
        return { ok: true };
    }

    async stopBot(botId, logout = false) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error('bot_not_found');
        await bot.stop({ logout: !!logout });
        return { ok: true };
    }

    async removeBot(botId, clearAuth = false) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error('bot_not_found');
        await bot.stop({ logout: false });

        if (clearAuth && fs.existsSync(bot.authPath)) {
            fs.rmSync(bot.authPath, { recursive: true, force: true });
        }

        this.bots.delete(botId);
        this.save();
        return { ok: true };
    }

    save() { 
        safeWriteJSON(BOTS_FILE, { 
            counter: this.counter, 
            bots: [...this.bots.values()].map(b => ({ 
                id: b.internalId, 
                phone: b.phoneNumber 
            })) 
        }); 
    }

    getMainBotId() {
        for (const [id, bot] of this.bots.entries()) {
            if (bot.connected) return id;
        }
        return 'Bot_1';
    }
}

function normalizeRoleList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(item => normalizeJid(String(item || '').trim())).filter(Boolean);
}

function startUiServer(manager) {
    const app = express();
    const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
    const tokens = new Map();
    const uiDir = path.join(__dirname, 'ui');

    function resolveAllowedOrigins() {
        return String(getUiOrigin() || '*')
            .split(',')
            .map(o => o.trim())
            .filter(Boolean);
    }

    function issueToken() {
        const token = crypto.randomBytes(24).toString('hex');
        tokens.set(token, { expiresAt: Date.now() + TOKEN_TTL_MS });
        return token;
    }

    function getTokenFromReq(req) {
        const auth = req.headers.authorization || '';
        if (auth.startsWith('Bearer ')) return auth.slice(7);
        if (req.query && req.query.token) return String(req.query.token);
        return null;
    }

    function isAuthed(req) {
        const token = getTokenFromReq(req);
        if (!token) return false;
        const data = tokens.get(token);
        if (!data || data.expiresAt < Date.now()) {
            tokens.delete(token);
            return false;
        }
        return true;
    }

    function requireAuth(req, res, next) {
        if (!isAuthed(req)) return res.status(401).json({ error: 'unauthorized' });
        next();
    }

    app.use(express.static(uiDir));
    app.use(express.json({ limit: '1mb' }));
    app.use(cors({
        origin: (origin, cb) => {
            const allowed = resolveAllowedOrigins();
            const allowAll = allowed.includes('*');
            if (!origin || allowAll || allowed.includes(origin)) return cb(null, true);
            return cb(new Error('not_allowed'), false);
        }
    }));

    app.post('/api/login', (req, res) => {
        const username = String(req.body?.username || '');
        const password = String(req.body?.password || '');
        if (!username || username !== getUiUsername()) return res.status(401).json({ error: 'invalid_username' });
        if (!password || password !== getUiPassword()) return res.status(401).json({ error: 'invalid_password' });
        const token = issueToken();
        res.json({ token, expiresAt: Date.now() + TOKEN_TTL_MS });
    });

    app.post('/api/password', requireAuth, (req, res) => {
        if (process.env.UI_PASSWORD) return res.status(400).json({ error: 'password_managed_by_env' });
        const oldPassword = String(req.body?.oldPassword || '');
        const newPassword = String(req.body?.newPassword || '');
        if (!oldPassword || oldPassword !== getUiPassword()) return res.status(403).json({ error: 'invalid_password' });
        if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'weak_password' });
        updateConfig({ uiPassword: newPassword });
        res.json({ ok: true });
    });

    app.get('/api/status', requireAuth, (req, res) => {
        res.json({ bots: manager.getBotStatus(), mainBotId: manager.getMainBotId() });
    });

    app.get('/api/config', requireAuth, (req, res) => {
        res.json({
            prefix: globalConfig.prefix,
            uiOrigin: getUiOrigin(),
            uiPort: globalConfig.uiPort,
            passwordManagedByEnv: !!process.env.UI_PASSWORD,
            originManagedByEnv: !!process.env.UI_ORIGIN
        });
    });

    app.post('/api/config', requireAuth, (req, res) => {
        const prefix = typeof req.body?.prefix === 'string' ? req.body.prefix.trim() : null;
        const uiOrigin = typeof req.body?.uiOrigin === 'string' ? req.body.uiOrigin.trim() : null;
        const updates = {};

        if (prefix) updates.prefix = prefix;
        if (uiOrigin) updates.uiOrigin = uiOrigin;
        if (Object.keys(updates).length > 0) updateConfig(updates);
        if (updates.prefix) GLOBAL_PREFIX = updates.prefix;

        res.json({ ok: true, needsRestart: false });
    });

    app.get('/api/roles', requireAuth, (req, res) => {
        res.json({ admins: roles.admins, subAdmins: roles.subAdmins });
    });

    app.post('/api/roles', requireAuth, (req, res) => {
        const admins = normalizeRoleList(req.body?.admins || []);
        const subAdmins = normalizeRoleList(req.body?.subAdmins || []);
        roles = { admins, subAdmins };
        safeWriteJSON(ROLES_FILE, roles);
        res.json({ ok: true });
    });

    app.post('/api/bots', requireAuth, async (req, res) => {
        try {
            const useQR = !!req.body?.useQR;
            const phone = req.body?.phone ? String(req.body.phone) : null;
            if (!useQR && !phone) return res.status(400).json({ error: 'phone_required' });
            const result = await manager.addBot({ phone, useQR });
            res.json(result);
        } catch (err) {
            console.error('[UI] Add bot failed:', err?.message || err);
            res.status(500).json({ error: 'add_failed', detail: err?.message || 'unknown_error' });
        }
    });

    app.post('/api/bots/:id/start', requireAuth, async (req, res) => {
        try {
            const result = await manager.startBot(req.params.id);
            res.json(result);
        } catch (err) {
            res.status(404).json({ error: 'bot_not_found' });
        }
    });

    app.post('/api/bots/:id/stop', requireAuth, async (req, res) => {
        try {
            const logout = !!req.body?.logout;
            const result = await manager.stopBot(req.params.id, logout);
            res.json(result);
        } catch (err) {
            res.status(404).json({ error: 'bot_not_found' });
        }
    });

    app.delete('/api/bots/:id', requireAuth, async (req, res) => {
        try {
            const clearAuth = String(req.query?.clearAuth || '') === 'true';
            const result = await manager.removeBot(req.params.id, clearAuth);
            res.json(result);
        } catch (err) {
            res.status(404).json({ error: 'bot_not_found' });
        }
    });

    app.get('/api/qr', requireAuth, (req, res) => {
        const botId = String(req.query?.botId || '');
        if (!botId) return res.status(400).json({ error: 'bot_required' });
        const data = qrCache.get(botId);
        if (!data) return res.status(404).json({ error: 'no_qr' });
        res.json(data);
    });

    app.post('/api/send', requireAuth, async (req, res) => {
        const botId = String(req.body?.botId || '');
        const jid = String(req.body?.jid || '');
        const text = String(req.body?.text || '');
        if (!botId || !jid || !text) return res.status(400).json({ error: 'missing_fields' });

        const bot = manager.bots.get(botId) || manager.bots.get(manager.getMainBotId());
        if (!bot) return res.status(404).json({ error: 'bot_not_found' });

        try {
            await bot.send(normalizeJid(jid), text);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: 'send_failed' });
        }
    });

    app.get('/api/logs', (req, res) => {
        if (!isAuthed(req)) return res.status(401).end();

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const sendLine = (line) => {
            res.write(`event: log\ndata: ${JSON.stringify({ line })}\n\n`);
        };

        logBuffer.forEach(sendLine);
        logEmitter.on('log', sendLine);

        req.on('close', () => {
            logEmitter.off('log', sendLine);
        });
    });

    const uiPort = Number(process.env.UI_PORT || globalConfig.uiPort || 8787);
    app.listen(uiPort, () => {
        console.log(`UI server listening on port ${uiPort}`);
        if (getUiPassword() === 'change-me' && !process.env.UI_PASSWORD) {
            console.log('UI password is change-me. Update it from the UI or set UI_PASSWORD.');
        }
    });
}

console.log('╔═══════════════════════════════════════╗');
console.log('║    ❄️ SEMIQUANTUM V3.6 ❄️     ║');
console.log('╚═══════════════════════════════════════╝\n');

const manager = new BotManager();

(async () => {
    await manager.init();
    startUiServer(manager);
})();

