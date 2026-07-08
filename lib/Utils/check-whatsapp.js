"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkWhatsApp = void 0;
/**
 * check-whatsapp.js
 *
 * Utilidad standalone para revisar si un número de WhatsApp está baneado o
 * bloqueado del uso de clientes no oficiales. Funciona haciendo un intento de
 * registro (pairing code) y leyendo el error resultante.
 *
 * ⚠️  Esto abre una conexión secundaria temporal a los servidores de WhatsApp.
 *     Úsalo con moderación — no lo llames en un loop ni en cada mensaje.
 *
 * Portado y adaptado a CommonJS desde un fork personal de Baileys (TypeScript).
 *
 * @example
 * const { checkWhatsApp } = require('d-baileys')
 * const result = await checkWhatsApp('+56912345678', authState)
 * if (result.isBanned) {
 *   console.log('Número baneado:', result.data)
 * }
 */
const checkWhatsApp = async (phoneNumber, authState, socketConfig) => {
    let number = phoneNumber.includes('@') ? phoneNumber.split('@')[0] : phoneNumber;
    number = number.replace(/[^\d]/g, '');
    if (!number.startsWith('+'))
        number = `+${number}`;
    const result = { isBanned: false, isNeedOfficialWa: false, number };
    let countryCallingCode;
    let nationalNumber;
    try {
        // libphonenumber-js ya es dependencia de d-baileys
        const { parsePhoneNumber } = require('libphonenumber-js');
        const parsed = parsePhoneNumber(number);
        countryCallingCode = parsed.countryCallingCode;
        nationalNumber = parsed.nationalNumber;
    }
    catch (_a) {
        // Fallback: asume código de país de 2 dígitos. Funciona para la mayoría de casos.
        countryCallingCode = number.slice(1, 3);
        nationalNumber = number.slice(3);
    }
    try {
        // require perezoso para evitar dependencia circular: Utils -> Socket -> Utils
        const makeWASocket = require('../Socket').default || require('../Socket');
        const { fetchLatestBaileysVersion } = require('./generics');
        const { version } = await fetchLatestBaileysVersion();
        const probeSocket = makeWASocket(Object.assign({ version, auth: authState, printQRInTerminal: false }, socketConfig));
        try {
            const probeFn = probeSocket.requestPairingCode;
            if (typeof probeFn !== 'function') {
                throw new TypeError('checkWhatsApp: el socket no expone una API de registro en esta versión. ' +
                    'La detección de baneo requiere un socket con soporte de registro.');
            }
            await probeFn(`${countryCallingCode}${nationalNumber}`);
        }
        finally {
            probeSocket.end(undefined);
        }
    }
    catch (err) {
        const e = err;
        if (e && e['appeal_token']) {
            result.isBanned = true;
            result.data = {
                violation_type: e['violation_type'] !== null && e['violation_type'] !== void 0 ? e['violation_type'] : null,
                in_app_ban_appeal: e['in_app_ban_appeal'],
                appeal_token: e['appeal_token'] !== null && e['appeal_token'] !== void 0 ? e['appeal_token'] : null
            };
        }
        else if (e && (e['custom_block_screen'] || e['reason'] === 'blocked')) {
            result.isNeedOfficialWa = true;
        }
        // Otros errores (red, auth) — se devuelve el resultado por defecto { isBanned: false }
    }
    return result;
};
exports.checkWhatsApp = checkWhatsApp;
