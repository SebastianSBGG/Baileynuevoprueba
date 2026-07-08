const WAProto = require('../../WAProto').proto;
const crypto = require('crypto');
const Utils_1 = require("../Utils");
const WABinary_1 = require("../WABinary");

class Z {
    constructor(utils, waUploadToServer, relayMessageFn, config, sock) {
        this.utils = utils;
        this.relayMessage = relayMessageFn;
        this.waUploadToServer = waUploadToServer;
        this.config = config;
        this.sock = sock;
        
        this.bail = {
            generateWAMessageContent: this.utils.generateWAMessageContent || Utils_1.generateWAMessageContent,
            generateMessageID: Utils_1.generateMessageID,
            getContentType: (msg) => Object.keys(msg.message || {})[0]
        };
    }

    detectType(content) {
        if (content.requestPaymentMessage) return 'PAYMENT';
        if (content.productMessage) return 'PRODUCT';
        if (content.interactiveButtons) return 'INTERACTIVE_BUTTONS';
        if (content.interactiveMessage) return 'INTERACTIVE';
        if (content.albumMessage) return 'ALBUM';
        if (content.eventMessage) return 'EVENT';
        if (content.pollResultMessage) return 'POLL_RESULT';
        if (content.groupStatusMessage) return 'GROUP_STORY';
        if (content.nestedListMessage) return 'NESTED_LIST';
        if (content.multiSelectMessage) return 'MULTI_SELECT';
        return null;
    }

    async handlePayment(content, quoted) {
        const data = content.requestPaymentMessage;
        let notes = {};

        if (data.sticker?.stickerMessage) {
            notes = {
                stickerMessage: {
                    ...data.sticker.stickerMessage,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant || content.sender,
                        quotedMessage: quoted?.message
                    }
                }
            };
        } else if (data.note) {
            notes = {
                extendedTextMessage: {
                    text: data.note,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant || content.sender,
                        quotedMessage: quoted?.message
                    }
                }
            };
        }

        return {
            requestPaymentMessage: WAProto.Message.RequestPaymentMessage.fromObject({
                expiryTimestamp: data.expiry || 0,
                amount1000: data.amount || 0,
                currencyCodeIso4217: data.currency || "IDR",
                requestFrom: data.from || "0@s.whatsapp.net",
                noteMessage: notes,
                background: data.background ?? {
                    id: "DEFAULT",
                    placeholderArgb: 0xFFF0F0F0
                }
            })
        };
    }
        
    async handleProduct(content, jid, quoted) {
        const {
            title, 
            description, 
            thumbnail,
            productId, 
            retailerId, 
            url, 
            body = "", 
            footer = "", 
            buttons = [],
            priceAmount1000 = null,
            currencyCode = "IDR"
        } = content.productMessage;

        let productImage;

        if (Buffer.isBuffer(thumbnail)) {
            const { imageMessage } = await this.utils.generateWAMessageContent(
                { image: thumbnail }, 
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        } else if (typeof thumbnail === 'object' && thumbnail.url) {
            const { imageMessage } = await this.utils.generateWAMessageContent(
                { image: { url: thumbnail.url }}, 
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        }

        return {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        body: { text: body },
                        footer: { text: footer },
                        header: {
                            title,
                            hasMediaAttachment: true,
                            productMessage: {
                                product: {
                                    productImage,
                                    productId,
                                    title,
                                    description,
                                    currencyCode,
                                    priceAmount1000,
                                    retailerId,
                                    url,
                                    productImageCount: 1
                                },
                                businessOwnerJid: "0@s.whatsapp.net"
                            }
                        },
                        nativeFlowMessage: { buttons }
                    }
                }
            }
        };
    }
    
    async handleInteractive(content, jid, quoted) {
        const {
            title,
            footer,
            thumbnail,
            image,
            video,
            document,
            mimetype,
            fileName,
            jpegThumbnail,
            contextInfo,
            externalAdReply,
            buttons = [],
            nativeFlowMessage,
            header
        } = content.interactiveMessage;

        let media = null;
        let mediaType = null;

        if (thumbnail) {
            media = await this.utils.prepareWAMessageMedia(
                { image: { url: thumbnail } },
                { upload: this.waUploadToServer }
            );
            mediaType = 'image';
        } else if (image) {
            if (typeof image === 'object' && image.url) {
                media = await this.utils.prepareWAMessageMedia(
                    { image: { url: image.url } },
                    { upload: this.waUploadToServer }
                );
            } else {
                media = await this.utils.prepareWAMessageMedia(
                    { image: image },
                    { upload: this.waUploadToServer }
                );
            }
            mediaType = 'image';
        } else if (video) {
            if (typeof video === 'object' && video.url) {
                media = await this.utils.prepareWAMessageMedia(
                    { video: { url: video.url } },
                    { upload: this.waUploadToServer }
                );
            } else {
                media = await this.utils.prepareWAMessageMedia(
                    { video: video },
                    { upload: this.waUploadToServer }
                );
            }
            mediaType = 'video';
        } else if (document) {
            let documentPayload = { 
                document: document 
            };
            if (jpegThumbnail) {
                if (typeof jpegThumbnail === 'object' && jpegThumbnail.url) {
                    documentPayload.jpegThumbnail = { url: jpegThumbnail.url };
                } else {
                    documentPayload.jpegThumbnail = jpegThumbnail;
                }
            }
            
            media = await this.utils.prepareWAMessageMedia(
                documentPayload,
                { upload: this.waUploadToServer }
            );
            if (fileName) {
                media.documentMessage.fileName = fileName;
            }
            if (mimetype) {
                media.documentMessage.mimetype = mimetype;
            }
            mediaType = 'document';
        }
        let interactiveMessage = {
            body: { text: title || "" },
            footer: { text: footer || "" }
        };
        if (buttons && buttons.length > 0) {
            interactiveMessage.nativeFlowMessage = {
                buttons: buttons
            };
            if (nativeFlowMessage) {
                interactiveMessage.nativeFlowMessage = {
                    ...interactiveMessage.nativeFlowMessage,
                    ...nativeFlowMessage
                };
            }
        } else if (nativeFlowMessage) {
            interactiveMessage.nativeFlowMessage = nativeFlowMessage;
        }
        
        if (media) {
            interactiveMessage.header = {
                title: header || "",
                hasMediaAttachment: true,
                ...media
            };
        } else {
            interactiveMessage.header = {
                title: header || "",        
                hasMediaAttachment: false
            };
        }
        
        let finalContextInfo = {};
        if (contextInfo) {
            finalContextInfo = {
                mentionedJid: contextInfo.mentionedJid || [],
                forwardingScore: contextInfo.forwardingScore || 0,
                isForwarded: contextInfo.isForwarded || false,
                ...contextInfo
            };
        }
        
        if (externalAdReply) {
            finalContextInfo.externalAdReply = {
                title: externalAdReply.title || "",
                body: externalAdReply.body || "",
                mediaType: externalAdReply.mediaType || 1,
                thumbnailUrl: externalAdReply.thumbnailUrl || "",
                mediaUrl: externalAdReply.mediaUrl || "",
                sourceUrl: externalAdReply.sourceUrl || "",
                showAdAttribution: externalAdReply.showAdAttribution || false,
                renderLargerThumbnail: externalAdReply.renderLargerThumbnail || false,
                ...externalAdReply
            };
        }
        
        if (Object.keys(finalContextInfo).length > 0) {
            interactiveMessage.contextInfo = finalContextInfo;
        }
        return {
            interactiveMessage: interactiveMessage
        };
    }

    async handleInteractiveButtons(content, jid, quoted) {
        const {
            text,
            caption,
            title,
            subtitle,
            footer,
            interactiveButtons,
            hasMediaAttachment,
            image,
            video,
            document,
            mimetype,
            jpegThumbnail,
            location,
            product,
            businessOwnerJid
        } = content;

        const bodyText = text || caption || '';
        const buttons = interactiveButtons.map(btn => ({
            name: btn.name,
            buttonParamsJson: typeof btn.buttonParamsJson === 'string'
                ? btn.buttonParamsJson
                : JSON.stringify(btn.buttonParamsJson)
        }));

        let headerContent = {};
        let mediaAttached = typeof hasMediaAttachment === 'boolean' ? hasMediaAttachment : false;

        if (image) {
            const mediaSource = typeof image === 'object' && image.url
                ? { image: { url: image.url } }
                : { image };
            const uploaded = await this.utils.prepareWAMessageMedia(
                mediaSource,
                { upload: this.waUploadToServer }
            );
            headerContent = { ...uploaded };
            mediaAttached = typeof hasMediaAttachment === 'boolean' ? hasMediaAttachment : true;
        } else if (video) {
            const mediaSource = typeof video === 'object' && video.url
                ? { video: { url: video.url } }
                : { video };
            const uploaded = await this.utils.prepareWAMessageMedia(
                mediaSource,
                { upload: this.waUploadToServer }
            );
            headerContent = { ...uploaded };
            mediaAttached = typeof hasMediaAttachment === 'boolean' ? hasMediaAttachment : true;
        } else if (document) {
            const docPayload = typeof document === 'object' && document.url
                ? { document: { url: document.url } }
                : { document };
            if (mimetype) docPayload.mimetype = mimetype;
            const uploaded = await this.utils.prepareWAMessageMedia(
                docPayload,
                { upload: this.waUploadToServer }
            );
            if (jpegThumbnail) {
                uploaded.documentMessage.jpegThumbnail = typeof jpegThumbnail === 'string'
                    ? Buffer.from(jpegThumbnail, 'base64')
                    : jpegThumbnail;
            }
            headerContent = { ...uploaded };
            mediaAttached = typeof hasMediaAttachment === 'boolean' ? hasMediaAttachment : true;
        } else if (location) {
            headerContent = {
                locationMessage: {
                    degreesLatitude: location.degressLatitude || location.degreesLatitude || 0,
                    degreesLongitude: location.degressLongitude || location.degreesLongitude || 0,
                    name: location.name || ''
                }
            };
            mediaAttached = typeof hasMediaAttachment === 'boolean' ? hasMediaAttachment : true;
        } else if (product) {
            let productImage;
            if (product.productImage) {
                const imgSource = typeof product.productImage === 'object' && product.productImage.url
                    ? { image: { url: product.productImage.url } }
                    : { image: product.productImage };
                const uploaded = await this.utils.prepareWAMessageMedia(
                    imgSource,
                    { upload: this.waUploadToServer }
                );
                productImage = uploaded.imageMessage;
            }
            headerContent = {
                productMessage: {
                    product: {
                        productImage,
                        productId: product.productId,
                        title: product.title,
                        description: product.description,
                        currencyCode: product.currencyCode || 'IDR',
                        priceAmount1000: product.priceAmount1000,
                        retailerId: product.retailerId,
                        url: product.url,
                        productImageCount: product.productImageCount || 1
                    },
                    businessOwnerJid: businessOwnerJid || '0@s.whatsapp.net'
                }
            };
            mediaAttached = typeof hasMediaAttachment === 'boolean' ? hasMediaAttachment : true;
        }

        const interactiveMessage = {
            body: { text: bodyText },
            footer: { text: footer || '' },
            header: {
                title: title || '',
                subtitle: subtitle || '',
                hasMediaAttachment: mediaAttached,
                ...headerContent
            },
            nativeFlowMessage: { buttons }
        };

        const msg = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2,
                        messageSecret: crypto.randomBytes(32)
                    },
                    interactiveMessage
                }
            }
        };

        return msg;
    }

    async handleAlbum(content, jid, quoted) {
        const array = content.albumMessage || content.album;
        const ctxInfo = content.contextInfo || {};
        const album = await this.utils.generateWAMessageFromContent(jid, {
            messageContextInfo: {
                messageSecret: crypto.randomBytes(32),
            },
            albumMessage: {
                expectedImageCount: array.filter((a) => a.hasOwnProperty("image")).length,
                expectedVideoCount: array.filter((a) => a.hasOwnProperty("video")).length,
            },
        }, {
            userJid: this.utils.generateMessageID().split('@')[0] + '@s.whatsapp.net',
            quoted,
            upload: this.waUploadToServer
        });
        
        await this.relayMessage(jid, album.message, {
            messageId: album.key.id,
        });
        
        for (let item of array) {
            if (ctxInfo && Object.keys(ctxInfo).length > 0 && !item.contextInfo) {
                item = { ...item, contextInfo: ctxInfo };
            }
            const img = await this.utils.generateWAMessage(jid, item, {
                upload: this.waUploadToServer,
            });
            
            img.message.messageContextInfo = {
                messageSecret: crypto.randomBytes(32),
                messageAssociation: {
                    associationType: 1,
                    parentMessageKey: album.key,
                },    
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast",
                forwardingScore: 99999,
                isForwarded: true,
                mentionedJid: [jid],
                starred: true,
                labels: ["Y", "Important"],
                isHighlighted: true,
                businessMessageForwardInfo: {
                    businessOwnerJid: jid,
                },
                dataSharingContext: {
                    showMmDisclosure: true,
                },
            };

            img.message.forwardedNewsletterMessageInfo = {
                newsletterJid: "0@newsletter",
                serverMessageId: 1,
                newsletterName: `WhatsApp`,
                contentType: 1,
                timestamp: new Date().toISOString(),
                senderName: "Ourin Team",
                content: "Text Message",
                priority: "high",
                status: "sent",
            };
            
            img.message.disappearingMode = {
                initiator: 3,
                trigger: 4,
                initiatorDeviceJid: jid,
                initiatedByExternalService: true,
                initiatedByUserDevice: true,
                initiatedBySystem: true,      
                initiatedByServer: true,
                initiatedByAdmin: true,
                initiatedByUser: true,
                initiatedByApp: true,
                initiatedByBot: true,
                initiatedByMe: true,
            };

            await this.relayMessage(jid, img.message, {
                messageId: img.key.id,
                quoted: {
                    key: {
                        remoteJid: album.key.remoteJid,
                        id: album.key.id,
                        fromMe: true,
                        participant: this.utils.generateMessageID().split('@')[0] + '@s.whatsapp.net',
                    },
                    message: album.message,
                },
            });
        }
        return album;
    }   

    async handleEvent(content, jid, quoted) {
        const eventData = content.eventMessage;
        
        const msg = await this.utils.generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2,
                        messageSecret: crypto.randomBytes(32),
                        supportPayload: JSON.stringify({
                            version: 2,
                            is_ai_message: true,
                            should_show_system_message: true,
                            ticket_id: crypto.randomBytes(16).toString('hex')
                        })
                    },
                    eventMessage: {
                        contextInfo: {
                            mentionedJid: [jid],
                            participant: jid,
                            remoteJid: "status@broadcast",
                            forwardedNewsletterMessageInfo: {
                                newsletterName: "Mancos Y Asociados Channel",
                                newsletterJid: "-120363368618055639@newsletter",
                                serverMessageId: 1
                            }
                        },
                        isCanceled: eventData.isCanceled || false,
                        name: eventData.name,
                        description: eventData.description,
                        location: eventData.location || {
                            degreesLatitude: 0,
                            degreesLongitude: 0,
                            name: "Location"
                        },
                        joinLink: eventData.joinLink || '',
                        startTime: typeof eventData.startTime === 'string' ? parseInt(eventData.startTime) : eventData.startTime || Date.now(),
                        endTime: typeof eventData.endTime === 'string' ? parseInt(eventData.endTime) : eventData.endTime || Date.now() + 3600000,
                        extraGuestsAllowed: eventData.extraGuestsAllowed !== false
                    }
                }
            }
        }, { quoted });
        
        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        });
        return msg;
    }
    
    async handlePollResult(content, jid, quoted) {
        const pollData = content.pollResultMessage;
    
        const msg = await this.utils.generateWAMessageFromContent(jid, {
            pollResultSnapshotMessage: {
                name: pollData.name,
                pollVotes: pollData.pollVotes.map(vote => ({
                    optionName: vote.optionName,
                    optionVoteCount: typeof vote.optionVoteCount === 'number' 
                    ? vote.optionVoteCount.toString() 
                    : vote.optionVoteCount
                }))
            }
        }, {
            userJid: this.utils.generateMessageID().split('@')[0] + '@s.whatsapp.net',
            quoted
        });
    
        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        });

        return msg;
    }

    /**
     * Group Status V2 — kirim story/status ke grup.
     *
     * PATCH (portado de vinzsocket/Baileys 3.2.9-3.2.10): ahora incluye
     * `messageContextInfo.messageSecret` (obligatorio para que el cliente de WA
     * pueda desencriptar/mostrar el contenido) y `additionalNodes` con el meta
     * <meta is_vsn2="1"/> en cada relayMessage(). Sin esto el mensaje se envía y
     * encripta normalmente, pero el cliente receptor nunca sabe que debe
     * renderizarlo como story/status de grupo — solo el propio remitente podía
     * "verlo" (como card de mensaje normal, no story).
     *
     * Modos soportados en `content.groupStatusMessage`:
     *   { text }, { image }, { video }, { gif } (shorthand → video con loop),
     *   { audio, ptt? }, { sticker }, { document }, { card: {...} } (imagen
     *   generada con renderStoryCard), { message: <WAMessage inner> }, { raw }.
     * Todos soportan además: caption, mentions, backgroundColor, textArgb, font.
     */
    async handleGroupStory(content, jid) {
        const s = content.groupStatusMessage;
        const secret = crypto.randomBytes(32);
        const buildNodes = this.utils.buildInteractiveAdditionalNodes;

        // Modo 1: raw relay directo
        if (s.raw) {
            const additionalNodes = buildNodes ? buildNodes(jid, s.raw) : [];
            return await this.relayMessage(jid, s.raw, {
                messageId: this.bail.generateMessageID(),
                additionalNodes
            });
        }

        // Modo 2: WAMessage inner ya preparado — envolver con secret
        if (s.message) {
            const wrapped = {
                groupStatusMessageV2: {
                    message: {
                        messageContextInfo: {
                            messageSecret: secret,
                            deviceListMetadata: {},
                            deviceListMetadataVersion: 2
                        },
                        ...s.message
                    }
                }
            };
            const additionalNodes = buildNodes ? buildNodes(jid, wrapped) : [];
            return await this.relayMessage(jid, wrapped, {
                messageId: this.bail.generateMessageID(),
                additionalNodes
            });
        }

        // Modo 3: generar desde media/texto
        let innerMessage = {};
        const normalizeMentions = this.utils.normalizeMentions || (m => Array.isArray(m) ? m : (m ? [m] : []));
        const mentionCtx = (Array.isArray(s.mentions) && s.mentions.length)
            ? { contextInfo: { mentionedJid: normalizeMentions(s.mentions) } }
            : {};

        if (s.text || (!s.image && !s.video && !s.gif && !s.audio && !s.sticker && !s.document && !s.card)) {
            innerMessage = {
                extendedTextMessage: {
                    text: s.text || s.caption || '',
                    ...(typeof s.backgroundColor !== 'undefined' ? { backgroundArgb: s.backgroundColor } : {}),
                    ...(typeof s.textArgb !== 'undefined' ? { textArgb: s.textArgb } : {}),
                    ...(typeof s.font !== 'undefined' ? { font: s.font } : {}),
                    ...mentionCtx
                }
            };
        } else if (s.image) {
            const media = await this.utils.prepareWAMessageMedia({ image: s.image }, { upload: this.waUploadToServer });
            if (s.caption) media.imageMessage.caption = s.caption;
            if (mentionCtx.contextInfo) media.imageMessage.contextInfo = { ...media.imageMessage.contextInfo, ...mentionCtx.contextInfo };
            innerMessage = media;
        } else if (s.card) {
            // Story visual generado por canvas (gradiente + título/cuerpo/pie), ver lib/Utils/story-card.js
            if (typeof this.utils.renderStoryCard !== 'function') {
                throw new (require('@hapi/boom').Boom)('handleGroupStory: renderStoryCard no está disponible (requiere el peer dependency opcional "jimp")', { statusCode: 500 });
            }
            const cardBuffer = await this.utils.renderStoryCard(s.card);
            const media = await this.utils.prepareWAMessageMedia({ image: cardBuffer }, { upload: this.waUploadToServer });
            if (s.caption) media.imageMessage.caption = s.caption;
            if (mentionCtx.contextInfo) media.imageMessage.contextInfo = { ...media.imageMessage.contextInfo, ...mentionCtx.contextInfo };
            innerMessage = media;
        } else if (s.gif) {
            // Shorthand: { gif: Buffer | { url }, caption? } — se envía como video en loop
            const media = await this.utils.prepareWAMessageMedia({ video: s.gif }, { upload: this.waUploadToServer });
            if (s.caption) media.videoMessage.caption = s.caption;
            media.videoMessage.gifPlayback = true;
            if (mentionCtx.contextInfo) media.videoMessage.contextInfo = { ...media.videoMessage.contextInfo, ...mentionCtx.contextInfo };
            innerMessage = media;
        } else if (s.video) {
            const media = await this.utils.prepareWAMessageMedia({ video: s.video }, { upload: this.waUploadToServer });
            if (s.caption) media.videoMessage.caption = s.caption;
            if (s.gifPlayback) media.videoMessage.gifPlayback = true;
            if (s.seconds) media.videoMessage.seconds = s.seconds;
            if (mentionCtx.contextInfo) media.videoMessage.contextInfo = { ...media.videoMessage.contextInfo, ...mentionCtx.contextInfo };
            innerMessage = media;
        } else if (s.audio) {
            const media = await this.utils.prepareWAMessageMedia({
                audio: s.audio,
                ptt: s.ptt !== false,
                ...(s.seconds ? { seconds: s.seconds } : {}),
                ...(s.mimetype ? { mimetype: s.mimetype } : {})
            }, {
                upload: this.waUploadToServer,
                ...(typeof s.backgroundColor !== 'undefined' ? { backgroundColor: s.backgroundColor } : {})
            });
            if (mentionCtx.contextInfo) media.audioMessage.contextInfo = { ...media.audioMessage.contextInfo, ...mentionCtx.contextInfo };
            innerMessage = media;
        } else if (s.sticker) {
            const media = await this.utils.prepareWAMessageMedia({ sticker: s.sticker }, { upload: this.waUploadToServer });
            if (mentionCtx.contextInfo) media.stickerMessage.contextInfo = { ...media.stickerMessage.contextInfo, ...mentionCtx.contextInfo };
            innerMessage = media;
        } else if (s.document) {
            const media = await this.utils.prepareWAMessageMedia({
                document: s.document,
                mimetype: s.mimetype || 'application/octet-stream',
                fileName: s.fileName || 'file'
            }, { upload: this.waUploadToServer });
            if (s.caption && media.documentMessage) media.documentMessage.caption = s.caption;
            if (s.fileName && media.documentMessage) media.documentMessage.fileName = s.fileName;
            if (mentionCtx.contextInfo && media.documentMessage) media.documentMessage.contextInfo = { ...media.documentMessage.contextInfo, ...mentionCtx.contextInfo };
            innerMessage = media;
        } else {
            innerMessage = await this.bail.generateWAMessageContent(s, { upload: this.waUploadToServer });
        }

        const wrapped = {
            groupStatusMessageV2: {
                message: {
                    messageContextInfo: {
                        messageSecret: secret,
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    ...innerMessage
                }
            }
        };

        const additionalNodes = buildNodes ? buildNodes(jid, wrapped) : [];

        return await this.relayMessage(jid, wrapped, {
            messageId: this.bail.generateMessageID(),
            additionalNodes
        });
    }

    // ─── NESTED_LIST (legacy listMessage con auto-flatten) ─────────────────

    /**
     * conn.sendMessage(jid, {
     *   nestedListMessage: {
     *     title, buttonText, footer,
     *     sections: [{ title, rows: [{ rowId, title, description?, rows? }] }]
     *   }
     * })
     * Una row con su propio `.rows` se aplana automáticamente como sección nueva.
     */
    async handleNestedList(content, jid, quoted) {
        const { title, buttonText, footer = '', sections = [] } = content.nestedListMessage;
        const flat = [];
        for (const sec of sections) {
            const topRows = [], childSecs = [];
            for (const row of (sec.rows || [])) {
                if (Array.isArray(row.rows) && row.rows.length > 0) {
                    childSecs.push({
                        title: row.title || '',
                        rows: row.rows.map(r => ({ rowId: r.rowId || r.id || '', title: r.title || '', description: r.description || '' }))
                    });
                } else {
                    topRows.push({ rowId: row.rowId || row.id || '', title: row.title || '', description: row.description || '' });
                }
            }
            if (topRows.length) flat.push({ title: sec.title || '', rows: topRows });
            for (const cs of childSecs) flat.push(cs);
        }
        const payload = { listMessage: { title, description: footer, buttonText, listType: 1, sections: flat } };
        return await this.utils.generateWAMessageFromContent(jid, {
            viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, ...payload } }
        }, { quoted });
    }

    // ─── MULTI_SELECT (varios botones single_select en 1 mensaje) ─────────

    /**
     * conn.sendMessage(jid, {
     *   multiSelectMessage: {
     *     title, footer,
     *     selectors: [{ displayText, sections: [{ title, rows: [{ id, title }] }] }]
     *   }
     * })
     */
    async handleMultiSelect(content, jid, quoted) {
        const { title, footer, image, video, thumbnail, selectors = [], extraButtons = [], contextInfo = {}, header } = content.multiSelectMessage;
        const buttons = [
            ...selectors.map((sel, i) => Z.nfButtonSingleSelect({
                id: sel.id || `select_${i}`,
                displayText: sel.displayText,
                sections: sel.sections
            })),
            ...extraButtons
        ];
        return this.handleInteractive({ interactiveMessage: { title, footer, image, video, thumbnail, header, contextInfo, buttons } }, jid, quoted);
    }

    async sendStatusWhatsApp(content, jids = []) {
        const userJid = WABinary_1.jidNormalizedUser(this.sock.authState.creds.me.id);
        let allUsers = new Set();
        allUsers.add(userJid);

        for (const id of jids) {
            const isGroup = WABinary_1.isJidGroup(id);
            const isPrivate = WABinary_1.isJidUser(id);

            if (isGroup) {
                try {
                    const metadata = await this.sock.groupMetadata(id);
                    const participants = metadata.participants.map(p => WABinary_1.jidNormalizedUser(p.id));
                    participants.forEach(jid => allUsers.add(jid));
                } catch (error) {
                    this.config.logger.error(`Error getting metadata for group ${id}: ${error}`);
                }
            } else if (isPrivate) {
                allUsers.add(WABinary_1.jidNormalizedUser(id));
            }
        }

        const uniqueUsers = Array.from(allUsers);
        const getRandomHexColor = () => "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");

        const isMedia = content.image || content.video || content.audio;
        const isAudio = !!content.audio;

        const messageContent = { ...content };

        if (isMedia && !isAudio) {
            if (messageContent.text) {
                messageContent.caption = messageContent.text;
                delete messageContent.text;
            }
            delete messageContent.ptt;
            delete messageContent.font;
            delete messageContent.backgroundColor;
            delete messageContent.textColor;
        }

        if (isAudio) {
            delete messageContent.text;
            delete messageContent.caption;
            delete messageContent.font;
            delete messageContent.textColor;
        }

        const font = !isMedia ? (content.font || Math.floor(Math.random() * 9)) : undefined;
        const textColor = !isMedia ? (content.textColor || getRandomHexColor()) : undefined;
        const backgroundColor = (!isMedia || isAudio) ? (content.backgroundColor || getRandomHexColor()) : undefined;
        const ptt = isAudio ? (typeof content.ptt === 'boolean' ? content.ptt : true) : undefined;

        let msg;
        let mediaHandle;
        
        try {
            const link_preview_1 = require("../Utils/link-preview");
            
            msg = await Utils_1.generateWAMessage(WABinary_1.STORIES_JID, messageContent, {
                logger: this.config.logger,
                userJid,
                getUrlInfo: text => link_preview_1.getUrlInfo(text, {
                    thumbnailWidth: this.config.linkPreviewImageThumbnailWidth,
                    fetchOpts: { timeout: 3000, ...this.config.options || {} },
                    logger: this.config.logger,
                    uploadImage: this.config.generateHighQualityLinkPreview ? this.waUploadToServer : undefined
                }),
                upload: async (encFilePath, opts) => {
                    const up = await this.waUploadToServer(encFilePath, { ...opts });
                    mediaHandle = up.handle;
                    return up;
                },
                mediaCache: this.config.mediaCache,
                options: this.config.options,
                font,
                textColor,
                backgroundColor,
                ptt
            });
        } catch (error) {
            this.config.logger.error(`Error generating message: ${error}`);
            throw error;
        }

        await this.relayMessage(WABinary_1.STORIES_JID, msg.message, {
            messageId: msg.key.id,
            statusJidList: uniqueUsers,
            additionalNodes: [
                {
                    tag: 'meta',
                    attrs: {},
                    content: [
                        {
                            tag: 'mentioned_users',
                            attrs: {},
                            content: jids.map(jid => ({
                                tag: 'to',
                                attrs: { jid: WABinary_1.jidNormalizedUser(jid) }
                            }))
                        }
                    ]
                }
            ]
        });

        for (const id of jids) {
            try {
                const normalizedId = WABinary_1.jidNormalizedUser(id);
                const isPrivate = WABinary_1.isJidUser(normalizedId);
                const type = isPrivate ? 'statusMentionMessage' : 'groupStatusMentionMessage';

                const protocolMessage = {
                    [type]: {
                        message: {
                            protocolMessage: {
                                key: msg.key,
                                type: 25
                            }
                        }
                    },
                    messageContextInfo: {
                        messageSecret: crypto.randomBytes(32)
                    }
                };

                const statusMsg = await Utils_1.generateWAMessageFromContent(
                    normalizedId,
                    protocolMessage,
                    {}
                );

                await this.relayMessage(
                    normalizedId,
                    statusMsg.message,
                    {
                        additionalNodes: [{
                            tag: 'meta',
                            attrs: isPrivate ?
                                { is_status_mention: 'true' } :
                                { is_group_status_mention: 'true' }
                        }]
                    }
                );

                await Utils_1.delay(2000);
            } catch (error) {
                this.config.logger.error(`Error sending to ${id}: ${error}`);
            }
        }

        return msg;
    }
}

// ─── NF V7 Button Builders (portados de vinzsocket) ────────────────────────
// Usables como Z.nfButtonUrl({...}), etc.

Z.nfButtonUrl = ({ id, displayText, url, merchantUrl }) => ({
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({ display_text: displayText, url, merchant_url: merchantUrl || url }),
    ...(id ? { id } : {})
});
Z.nfButtonCall = ({ id, displayText, phoneNumber }) => ({
    name: 'cta_call',
    buttonParamsJson: JSON.stringify({ display_text: displayText, phone_number: phoneNumber }),
    ...(id ? { id } : {})
});
Z.nfButtonCopy = ({ id, displayText, copyCode }) => ({
    name: 'cta_copy',
    buttonParamsJson: JSON.stringify({ display_text: displayText, copy_code: copyCode }),
    ...(id ? { id } : {})
});
Z.nfButtonReminder = ({ id, displayText, title, notes, startTime, endTime, timezone = 'America/Santiago' }) => ({
    name: 'cta_reminder',
    buttonParamsJson: JSON.stringify({ display_text: displayText, title, notes, start_timestamp: startTime, end_timestamp: endTime, timezone }),
    ...(id ? { id } : {})
});
Z.nfButtonCancelReminder = ({ id, displayText, reminderKey }) => ({
    name: 'cta_cancel_reminder',
    buttonParamsJson: JSON.stringify({ display_text: displayText, reminder_key: reminderKey }),
    ...(id ? { id } : {})
});
Z.nfButtonAddress = ({ id, displayText, label = '' }) => ({
    name: 'address_message',
    buttonParamsJson: JSON.stringify({ display_text: displayText, label }),
    ...(id ? { id } : {})
});
Z.nfButtonLocation = ({ id, displayText }) => ({
    name: 'send_location',
    buttonParamsJson: JSON.stringify({ display_text: displayText }),
    ...(id ? { id } : {})
});
Z.nfButtonQuickReply = ({ id, displayText, payload }) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: displayText, id: id || payload || displayText }),
    ...(id ? { id } : {})
});
/** sections: [{ title, highlight_label?, rows: [{id, title, description?}] }] */
Z.nfButtonSingleSelect = ({ id, displayText, sections = [] }) => ({
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
        title: displayText,
        sections: sections.map(sec => ({
            title: sec.title || '',
            highlight_label: sec.highlight_label || '',
            rows: (sec.rows || []).map(r => ({
                id: r.id || r.rowId || '',
                title: r.title || '',
                ...(r.description ? { description: r.description } : {})
            }))
        }))
    }),
    ...(id ? { id } : {})
});
Z.nfButtonReviewPay = ({ id, currency = 'CLP', totalAmount1000, subtotal, tax, items = [], merchant = {} }) => ({
    name: 'review_and_pay',
    buttonParamsJson: JSON.stringify({ currency, total_amount: { value: totalAmount1000, offset: 1000 }, subtotal, tax, items, order: { status: 'pending', items }, merchant }),
    ...(id ? { id } : {})
});
Z.nfButtonReviewOrder = ({ id, referenceId, type = 'ORDER', orderId }) => ({
    name: 'review_order',
    buttonParamsJson: JSON.stringify({ reference_id: referenceId, type, order_id: orderId }),
    ...(id ? { id } : {})
});
Z.nfButtonMPM = ({ id, sections = [] }) => ({
    name: 'mpm',
    buttonParamsJson: JSON.stringify({
        sections: sections.map(sec => ({
            title: sec.title || '',
            product_items: (sec.productItems || []).map(p => ({ product_id: p.productId || p.product_id }))
        }))
    }),
    ...(id ? { id } : {})
});

module.exports = Z;