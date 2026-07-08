"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIDMappingStore = void 0;
const WABinary_1 = require("../WABinary");
let LRUCache;
try {
    // usa lru-cache si está disponible (recomendado)
    LRUCache = require("lru-cache").LRUCache;
}
catch (e) {
    // fallback simple en memoria si lru-cache no está instalado
    LRUCache = class SimpleCache extends Map {
        constructor() { super(); }
        get(k) { return super.get(k); }
        set(k, v) { super.set(k, v); return this; }
    };
}
class LIDMappingStore {
    constructor(keys, logger, pnToLIDFunc) {
        this.mappingCache = new LRUCache({
            max: 10000,
            ttl: 7 * 24 * 60 * 60 * 1000,
            ttlAutopurge: true,
            updateAgeOnGet: true
        });
        this.keys = keys;
        this.pnToLIDFunc = pnToLIDFunc;
        this.logger = logger || console;
    }
    async storeLIDPNMappings(pairs) {
        const pairMap = {};
        for (const { lid, pn } of pairs) {
            if (!((WABinary_1.isLidUser(lid) && WABinary_1.isPnUser(pn)) || (WABinary_1.isPnUser(lid) && WABinary_1.isLidUser(pn)))) {
                this.logger.warn?.(`Mapeo LID-PN inválido: ${lid}, ${pn}`);
                continue;
            }
            const lidDecoded = WABinary_1.jidDecode(lid);
            const pnDecoded = WABinary_1.jidDecode(pn);
            if (!lidDecoded || !pnDecoded)
                continue;
            const pnUser = pnDecoded.user;
            const lidUser = lidDecoded.user;
            let existingLidUser = this.mappingCache.get(`pn:${pnUser}`);
            if (!existingLidUser) {
                const stored = await this.keys.get('lid-mapping', [pnUser]);
                existingLidUser = stored[pnUser];
                if (existingLidUser) {
                    this.mappingCache.set(`pn:${pnUser}`, existingLidUser);
                    this.mappingCache.set(`lid:${existingLidUser}`, pnUser);
                }
            }
            if (existingLidUser === lidUser) {
                continue;
            }
            pairMap[pnUser] = lidUser;
        }
        if (Object.keys(pairMap).length === 0)
            return;
        await this.keys.transaction(async () => {
            for (const [pnUser, lidUser] of Object.entries(pairMap)) {
                await this.keys.set({
                    'lid-mapping': {
                        [pnUser]: lidUser,
                        [`${lidUser}_reverse`]: pnUser
                    }
                });
                this.mappingCache.set(`pn:${pnUser}`, lidUser);
                this.mappingCache.set(`lid:${lidUser}`, pnUser);
            }
        }, 'lid-mapping');
    }
    async getLIDForPN(pn) {
        const result = await this.getLIDsForPNs([pn]);
        return result?.[0]?.lid || null;
    }
    async getLIDsForPNs(pns) {
        const usyncFetch = {};
        const successfulPairs = {};
        for (const pn of pns) {
            if (!WABinary_1.isPnUser(pn) && !WABinary_1.isHostedPnUser?.(pn))
                continue;
            const decoded = WABinary_1.jidDecode(pn);
            if (!decoded)
                continue;
            const pnUser = decoded.user;
            let lidUser = this.mappingCache.get(`pn:${pnUser}`);
            if (!lidUser) {
                const stored = await this.keys.get('lid-mapping', [pnUser]);
                lidUser = stored[pnUser];
                if (lidUser) {
                    this.mappingCache.set(`pn:${pnUser}`, lidUser);
                    this.mappingCache.set(`lid:${lidUser}`, pnUser);
                }
                else {
                    const device = decoded.device || 0;
                    let normalizedPn = WABinary_1.jidNormalizedUser(pn);
                    if (!usyncFetch[normalizedPn]) {
                        usyncFetch[normalizedPn] = [device];
                    }
                    else {
                        usyncFetch[normalizedPn]?.push(device);
                    }
                    continue;
                }
            }
            lidUser = lidUser.toString();
            const pnDevice = decoded.device !== undefined ? decoded.device : 0;
            const deviceSpecificLid = `${lidUser}${pnDevice ? `:${pnDevice}` : ''}@lid`;
            successfulPairs[pn] = { lid: deviceSpecificLid, pn };
        }
        if (Object.keys(usyncFetch).length > 0 && this.pnToLIDFunc) {
            const result = await this.pnToLIDFunc(Object.keys(usyncFetch));
            if (result && result.length > 0) {
                this.storeLIDPNMappings(result);
                for (const pair of result) {
                    const pnDecoded = WABinary_1.jidDecode(pair.pn);
                    const pnUser = pnDecoded?.user;
                    if (!pnUser)
                        continue;
                    const lidUser = WABinary_1.jidDecode(pair.lid)?.user;
                    if (!lidUser)
                        continue;
                    for (const device of usyncFetch[pair.pn] || []) {
                        const deviceSpecificLid = `${lidUser}${device ? `:${device}` : ''}@lid`;
                        const deviceSpecificPn = `${pnUser}${device ? `:${device}` : ''}@s.whatsapp.net`;
                        successfulPairs[deviceSpecificPn] = { lid: deviceSpecificLid, pn: deviceSpecificPn };
                    }
                }
            }
        }
        return Object.values(successfulPairs);
    }
    async getPNForLID(lid) {
        if (!WABinary_1.isLidUser(lid))
            return null;
        const decoded = WABinary_1.jidDecode(lid);
        if (!decoded)
            return null;
        const lidUser = decoded.user;
        let pnUser = this.mappingCache.get(`lid:${lidUser}`);
        if (!pnUser || typeof pnUser !== 'string') {
            const stored = await this.keys.get('lid-mapping', [`${lidUser}_reverse`]);
            pnUser = stored[`${lidUser}_reverse`];
            if (!pnUser || typeof pnUser !== 'string') {
                return null;
            }
            this.mappingCache.set(`lid:${lidUser}`, pnUser);
        }
        const lidDevice = decoded.device !== undefined ? decoded.device : 0;
        const pnJid = `${pnUser}${lidDevice ? `:${lidDevice}` : ''}@s.whatsapp.net`;
        return pnJid;
    }
}
exports.LIDMappingStore = LIDMappingStore;
