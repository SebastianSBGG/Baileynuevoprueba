"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTagAllText = exports.applyMentions = exports.normalizeMentions = void 0;
// mention.js — helpers de menciones, portado de vinzsocket/baileys-lily.
const mentionCache = new Map();
/**
 * Normaliza menciones al formato JID correcto.
 * @param {string|string[]|null|undefined} mentions
 * @returns {string[]}
 */
function normalizeMentions(mentions) {
    const cacheKey = JSON.stringify(mentions);
    if (mentionCache.has(cacheKey)) {
        return mentionCache.get(cacheKey);
    }
    if (!mentions)
        return [];
    if (!Array.isArray(mentions))
        mentions = [mentions];
    const result = mentions
        .map(jid => {
        if (typeof jid !== 'string')
            return null;
        jid = jid.trim();
        if (!jid)
            return null;
        if (jid.includes('@s.whatsapp.net') || jid.includes('@lid')) {
            return jid;
        }
        if (jid.includes('@')) {
            return jid;
        }
        return jid + '@s.whatsapp.net';
    })
        .filter(Boolean);
    mentionCache.set(cacheKey, result);
    if (mentionCache.size > 1000)
        mentionCache.clear();
    return result;
}
exports.normalizeMentions = normalizeMentions;
/**
 * Aplica menciones a un objeto de mensaje (usado por Socket/dugong.js).
 */
function applyMentions(msg, mentions, contextInfo = {}) {
    var _a;
    const normalized = normalizeMentions(mentions);
    if (normalized.length === 0)
        return msg;
    if (!msg.messageContextInfo)
        msg.messageContextInfo = {};
    if (!msg.messageContextInfo.mentionedJid)
        msg.messageContextInfo.mentionedJid = [];
    const existing = new Set(msg.messageContextInfo.mentionedJid);
    for (const jid of normalized) {
        if (!existing.has(jid)) {
            msg.messageContextInfo.mentionedJid.push(jid);
            existing.add(jid);
        }
    }
    if (contextInfo && typeof contextInfo === 'object') {
        if (!contextInfo.mentionedJid)
            contextInfo.mentionedJid = [];
        for (const jid of normalized) {
            if (!contextInfo.mentionedJid.includes(jid)) {
                contextInfo.mentionedJid.push(jid);
            }
        }
    }
    if ((_a = msg.interactiveMessage) === null || _a === void 0 ? void 0 : _a.contextInfo) {
        if (!msg.interactiveMessage.contextInfo.mentionedJid) {
            msg.interactiveMessage.contextInfo.mentionedJid = [];
        }
        for (const jid of normalized) {
            if (!msg.interactiveMessage.contextInfo.mentionedJid.includes(jid)) {
                msg.interactiveMessage.contextInfo.mentionedJid.push(jid);
            }
        }
    }
    return msg;
}
exports.applyMentions = applyMentions;
/**
 * Construye un bloque de texto "mencionar a todos" + lista de mentionedJid a partir
 * de los participantes de un grupo (sock.groupMetadata(jid).participants).
 *
 * Maneja correctamente el rollout de privacidad "LID": cuando WhatsApp no reveló el
 * número de teléfono real de un participante, no se imprime el LID crudo como si
 * fuera un número (ej. "@206244447002720"), se usa el nombre de display si está
 * disponible o una etiqueta genérica.
 */
function buildTagAllText(participants, options = {}) {
    const { getDisplayName, header = '', footer = '' } = options;
    const lines = [];
    const mentions = [];
    for (const p of participants || []) {
        const realJid = p.jid && p.jid.endsWith('@s.whatsapp.net')
            ? p.jid
            : (p.phoneNumber ? (p.phoneNumber.includes('@') ? p.phoneNumber : `${p.phoneNumber}@s.whatsapp.net`) : null);
        const mentionJid = realJid || p.id;
        mentions.push(mentionJid);
        if (realJid) {
            lines.push(`@${realJid.split('@')[0]}`);
        }
        else {
            const name = typeof getDisplayName === 'function' ? getDisplayName(p.id) : null;
            lines.push(name ? `@${name}` : '@Member');
        }
    }
    const body = [header, lines.join('\n'), footer].filter(Boolean).join('\n\n');
    return { text: body, mentions };
}
exports.buildTagAllText = buildTagAllText;
