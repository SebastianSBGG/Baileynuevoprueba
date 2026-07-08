"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateKeyDeletions = void 0;
/**
 * Antes de aplicar un borrado (valor null) de una clave (pre-key, session, sender-key, etc),
 * verifica que la clave realmente exista en el store. Si no existe, lo descarta y avisa por log
 * en vez de dejarlo pasar en silencio.
 *
 * Esto evita el típico error "Bad MAC" / sesiones corruptas quue aparece cuando una pre-key se
 * intenta borrar dos veces (por ejemplo por una carrera entre dos mensajes procesados casi
 * simultáneamente).
 *
 * @param getExisting función para leer claves existentes: (type, ids) => Promise<Record<string, any>>
 * @param logger logger de pino (o compatible)
 * @param data objeto de mutaciones tal como lo recibe SignalKeyStore.set({ [type]: { [id]: value|null } })
 * @returns el mismo objeto `data`, pero con los borrados de claves inexistentes eliminados
 */
const validateKeyDeletions = async (getExisting, logger, data) => {
    for (const type of Object.keys(data)) {
        const keyData = data[type];
        if (!keyData)
            continue;
        const deletionIds = Object.keys(keyData).filter(id => keyData[id] === null || keyData[id] === undefined);
        if (deletionIds.length === 0)
            continue;
        let existingKeys;
        try {
            existingKeys = await getExisting(type, deletionIds);
        }
        catch (error) {
            // si falla la lectura, no bloqueamos el borrado (mejor fallar como antes que romper todo)
            continue;
        }
        for (const keyId of deletionIds) {
            if (!existingKeys?.[keyId]) {
                logger?.trace?.(`Se omite el borrado de ${type} inexistente: ${keyId}`);
                delete data[type][keyId];
            }
        }
        if (Object.keys(data[type]).length === 0) {
            delete data[type];
        }
    }
    return data;
};
exports.validateKeyDeletions = validateKeyDeletions;
