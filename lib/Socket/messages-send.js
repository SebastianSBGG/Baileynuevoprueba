"use strict"; 
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
}; 
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMessagesSocket = void 0;
const boom_1 = require("@hapi/boom");
const node_cache_1 = __importDefault(require("node-cache"));
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const link_preview_1 = require("../Utils/link-preview");
const WABinary_1 = require("../WABinary");
const newsletter_1 = require("./newsletter");
const WAUSync_1 = require("../WAUSync");
const Z = require('./dugong');
const makeMessagesSocket = (config) => {
    const {
        logger,
        linkPreviewImageThumbnailWidth, 
        generateHighQualityLinkPreview,
        options: axiosOptions,
        patchMessageBeforeSending
    } = config;
    const sock = (0, newsletter_1.makeNewsletterSocket)(config);
    const {
        ev, 
        authState, 
        processingMutex, 
        signalRepository, 
        upsertMessage,
        query,
        fetchPrivacySettings,
        sendNode, 
        groupMetadata,
        groupToggleEphemeral,
        executeUSyncQuery
    } = sock;
    const userDevicesCache = config.userDevicesCache || new node_cache_1.default({
        stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.USER_DEVICES,
        useClones: false
    });
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || (new Date().getTime() - media.fetchDate.getTime()) > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: WABinary_1.S_WHATSAPP_NET,
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = WABinary_1.getBinaryNodeChild(result, 'media_conn');
                const node = {
                    hosts: WABinary_1.getBinaryNodeChildren(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes,
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };
    const sendReceipt = async (jid, participant, messageIds, type) => {
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0],
            },
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = (0, Utils_1.unixTimestampSeconds)().toString();
        }
        if (type === 'sender' && WABinary_1.isJidUser(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = WABinary_1.isJidNewsLetter(jid) ? 'read-self' : type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    const sendReceipts = async (keys, type) => {
        const recps = (0, Utils_1.aggregateMessageKeysNotFromMe)(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        const deviceResults = []
        if (!useCache) {
            logger.debug('not using cache for devices')
        }
        const toFetch = []
        jids = Array.from(new Set(jids))
        for (let jid of jids) {
            const user = WABinary_1.jidDecode(jid)?.user
            jid = WABinary_1.jidNormalizedUser(jid)
            if (useCache) {
                const devices = userDevicesCache.get(user)
                if (devices) {
                    deviceResults.push(...devices)
                    logger.trace({ user }, 'using cache for devices')
                }
                else {
                    toFetch.push(jid)
                }
            }
            else {
                toFetch.push(jid)
            }
        }
        if (!toFetch.length) {
            return deviceResults
        }
        const query = new WAUSync_1.USyncQuery()
            .withContext('message')
            .withDeviceProtocol()
        for (const jid of toFetch) {
            query.withUser(new WAUSync_1.USyncUser().withId(jid))
        }
        const result = await executeUSyncQuery(query)
        if (result) {
            const extracted = Utils_1.extractDeviceJids(result?.list, authState.creds.me.id, ignoreZeroDevices)
            const deviceMap = {}
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || []
                deviceMap[item.user].push(item)
                deviceResults.push(item)
            }
            for (const key in deviceMap) {
                userDevicesCache.set(key, deviceMap[key])
            }
        }
        return deviceResults
    }
    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        let jidsRequiringFetch = [];
        if (force) {
            jidsRequiringFetch = jids;
        }
        else {
            const addrs = jids.map(jid => (signalRepository
                .jidToSignalProtocolAddress(jid)));
            const sessions = await authState.keys.get('session', addrs);
            for (const jid of jids) {
                const signalId = signalRepository
                    .jidToSignalProtocolAddress(jid);
                if (!sessions[signalId]) {
                    jidsRequiringFetch.push(jid);
                }
            }
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: WABinary_1.S_WHATSAPP_NET,
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: jidsRequiringFetch.map(jid => ({
                            tag: 'user',
                            attrs: { jid },
                        }))
                    }
                ]
            });
            await (0, Utils_1.parseAndInjectE2ESessions)(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;
    };
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        if (!authState.creds.me?.id) {
            throw new boom_1.Boom('Not authenticated')
        }
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: WAProto_1.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = WABinary_1.jidNormalizedUser(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force',
            },
        });
        return msgId;
    };
    const createParticipantNodes = async (jids, message, extraAttrs) => {
        const patched = await patchMessageBeforeSending(message, jids);
        const bytes = (0, Utils_1.encodeWAMessage)(patched);
        let shouldIncludeDeviceIdentity = false;
        const nodes = await Promise.all(jids.map(async (jid) => {
            const { type, ciphertext } = await signalRepository
                .encryptMessage({ jid, data: bytes });
            if (type === 'pkmsg') {
                shouldIncludeDeviceIdentity = true;
            }
            const node = {
                tag: 'to',
                attrs: { jid },
                content: [{
                        tag: 'enc',
                        attrs: {
                            v: '2',
                            type,
                            ...extraAttrs || {}
                        },
                        content: ciphertext
                    }]
            };
            return node;
        }));
        return { nodes, shouldIncludeDeviceIdentity };
    };
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, cachedGroupMetadata, useCachedGroupMetadata, statusJidList, AI = true }) => {
        const meId = authState.creds.me.id;
        let shouldIncludeDeviceIdentity = false;
        let didPushAdditional = false
        const { user, server } = WABinary_1.jidDecode(jid);
        const statusJid = 'status@broadcast';
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isPrivate = server === 's.whatsapp.net'
        const isNewsletter = server === 'newsletter';
        msgId = msgId || (0, Utils_1.generateMessageID)();
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus
        const participants = [];
        const destinationJid = (!isStatus) ? WABinary_1.jidEncode(user, isLid ? 'lid' : isGroup ? 'g.us' : isNewsletter ? 'newsletter' : 's.whatsapp.net') : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            }
        };
        const extraAttrs = {}
        const messages = Utils_1.normalizeMessageContent(message);
        const buttonType = getButtonType(messages);
        if (participant) {
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' };
            }
            const { user, device } = WABinary_1.jidDecode(participant.jid);
            devices.push({ user, device });
        }
        await authState.keys.transaction(async () => {
            const mediaType = getMediaType(messages);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType
            }
            if (messages.pinInChatMessage || messages.keepInChatMessage || message.reactionMessage || message.protocolMessage?.editedMessage) {
                extraAttrs['decrypt-fail'] = 'hide'
            }
            if (messages.interactiveResponseMessage?.nativeFlowResponseMessage) {
                extraAttrs['native_flow_name'] = messages.interactiveResponseMessage?.nativeFlowResponseMessage.name
            }
            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined
                        if (groupData) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }
                        else if (!isStatus) {
                            groupData = await groupMetadata(jid)
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid])
                            return result[jid] || {}
                        }
                        return {}
                    })()
                ]);
                if (!participant) {
                    const participantsList = (groupData && !isStatus) ? groupData.participants.map(p => p.id) : []
                    if (isStatus && statusJidList) {
                        participantsList.push(...statusJidList)
                    }
                    const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false)
                    devices.push(...additionalDevices)
                }
                const patched = await patchMessageBeforeSending(message, devices.map(d => WABinary_1.jidEncode(d.user, isLid ? 'lid' : 's.whatsapp.net', d.device)));
                const bytes = Utils_1.encodeWAMessage(patched);
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId,
                });
                const senderKeyJids = [];
                for (const { user, device } of devices) {
                    const jid = WABinary_1.jidEncode(user, (groupData === null || groupData === void 0 ? void 0 : groupData.addressingMode) === 'lid' ? 'lid' : 's.whatsapp.net', device);
                    if (!senderKeyMap[jid] || !!participant) {
                        senderKeyJids.push(jid);
                        senderKeyMap[jid] = true;
                    }
                }
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    await assertSessions(senderKeyJids, false);
                    const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs)
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg', ...extraAttrs },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else if (isNewsletter) {
                if (message.protocolMessage?.editedMessage) {
                    msgId = message.protocolMessage.key?.id
                    message = message.protocolMessage.editedMessage
                }
                if (message.protocolMessage?.type === WAProto_1.proto.Message.ProtocolMessage.Type.REVOKE) {
                    msgId = message.protocolMessage.key?.id
                    message = {}
                }
                const patched = await patchMessageBeforeSending(message, [])
                const bytes = Utils_1.encodeNewsletterMessage(patched)
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: extraAttrs ? extraAttrs : {},
                    content: bytes
                })
            }
            else {
                const { user: meUser } = WABinary_1.jidDecode(meId);
                if (!participant) {
                    devices.push({ user })
                    if (user !== meUser) {
                        devices.push({ user: meUser })
                    }
                    if (additionalAttributes?.['category'] !== 'peer') {
                        const additionalDevices = await getUSyncDevices([meId, jid], !!useUserDevicesCache, true)
                        devices.push(...additionalDevices)
                    }
                }
                const allJids = [];
                const meJids = [];
                const otherJids = [];
                for (const { user, device } of devices) {
                    const isMe = user === meUser
                    const jid = WABinary_1.jidEncode(isMe && isLid ? authState.creds?.me?.lid?.split(':')[0] || user : user, isLid ? 'lid' : 's.whatsapp.net', device)
                    if (isMe) {
                        meJids.push(jid)
                    }
                    else {
                        otherJids.push(jid)
                    }
                    allJids.push(jid)
                }
                await assertSessions(allJids, false);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meJids, meMsg, extraAttrs),
                    createParticipantNodes(otherJids, message, extraAttrs)
                ])
                participants.push(...meNodes);
                participants.push(...otherNodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (participants.length) {
                if (additionalAttributes?.['category'] === 'peer') {
                    const peerNode = participants[0]?.content?.[0]
                    if (peerNode) {
                        binaryNodeContent.push(peerNode)
                    }
                }
                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    })
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    type: getTypeMessage(messages),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            }
            if (participant) {
                if (WABinary_1.isJidGroup(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if (WABinary_1.areJidsSameUser(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            if (AI && isPrivate) {
                const botNode = {
                    tag: 'bot',
                    attrs: {
                        biz_bot: '1'
                    }
                }
                const filteredBizBot = WABinary_1.getBinaryNodeFilter(additionalNodes ? additionalNodes : [])
                if (filteredBizBot) {
                    stanza.content.push(...additionalNodes)
                    didPushAdditional = true
                }
                else {
                    stanza.content.push(botNode)
                }
            }
            if (!isNewsletter && buttonType && !isStatus) {
                const content = WABinary_1.getAdditionalNode(buttonType)
                const filteredNode = WABinary_1.getBinaryNodeFilter(additionalNodes)
                if (filteredNode) {
                    didPushAdditional = true
                    stanza.content.push(...additionalNodes)
                }
                else {
                    stanza.content.push(...content)
                }
                logger.debug({ jid }, 'adding business node')
            }
            if (!didPushAdditional && additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
        });
        message = Types_1.WAProto.Message.fromObject(message)
        const messageJSON = {
            key: {
                remoteJid: jid,
                fromMe: true,
                id: msgId
            },
            message: message,
            messageTimestamp: Utils_1.unixTimestampSeconds(new Date()),
            messageStubParameters: [],
            participant: WABinary_1.isJidGroup(jid) || WABinary_1.isJidStatusBroadcast(jid) ? meId : undefined,
            status: Types_1.WAMessageStatus.PENDING
        }
        return Types_1.WAProto.WebMessageInfo.fromObject(messageJSON);
    };
    const getTypeMessage = (msg) => {
        const message = Utils_1.normalizeMessageContent(msg);
        if (message.reactionMessage) {
            return 'reaction'
        }
        else if (getMediaType(message)) {
            return 'media'
        }
        else {
            return 'text'
        }
    }
    const MEDIA_TYPE_MAP = {
        imageMessage: 'image',
        contactMessage: 'vcard',
        documentMessage: 'document',
        contactsArrayMessage: 'contact_array',
        liveLocationMessage: 'livelocation',
        stickerMessage: 'sticker',
        listMessage: 'list',
        listResponseMessage: 'list_response',
        buttonsResponseMessage: 'buttons_response',
        orderMessage: 'order',
        productMessage: 'product',
        interactiveResponseMessage: 'native_flow_response',
        groupInviteMessage: 'url',
        stickerPackMessage: 'sticker_pack',
    }
    const getMediaType = (message) => {
        if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video'
        }
        if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio'
        }
        for (const key in MEDIA_TYPE_MAP) {
            if (message[key]) return MEDIA_TYPE_MAP[key]
        }
        if (/https:\/\/wa\.me\/p\/\d+\/\d+/.test(message.extendedTextMessage?.text)) {
            return 'productlink'
        }
    }
    const NATIVE_FLOW_BUTTON_MAP = {
        review_and_pay: 'review_and_pay',
        review_order: 'review_order',
        payment_info: 'payment_info',
        payment_status: 'payment_status',
        payment_method: 'payment_method',
    }
    const getButtonType = (message) => {
        if (message.listMessage) return 'list'
        if (message.buttonsMessage) return 'buttons'
        const btnName = message.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name;
        if (btnName && NATIVE_FLOW_BUTTON_MAP[btnName]) return NATIVE_FLOW_BUTTON_MAP[btnName]
        if (message.interactiveMessage?.nativeFlowMessage) return 'interactive'
    }
    const getPrivacyTokens = async (jids) => {
        const t = Utils_1.unixTimestampSeconds().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: WABinary_1.jidNormalizedUser(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    }
    const waUploadToServer = (0, Utils_1.getWAUploadToServer)(config, refreshMediaConn);
    const ourin = new Z(Utils_1, waUploadToServer, relayMessage, config, sock);
    const waitForMsgMediaUpdate = (0, Utils_1.bindWaitForEvent)(ev, 'messages.media-update');
    return {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        ourin,
        readMessages,
        refreshMediaConn,
        getUSyncDevices,
        createParticipantNodes,
        waUploadToServer,
        sendPeerDataOperationMessage,
        fetchPrivacySettings,
        updateMediaMessage: async (message) => {
            const content = (0, Utils_1.assertMediaContent)(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = (0, Utils_1.encryptMediaRetryRequest)(message.key, mediaKey, meId);
            let error = undefined;
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(update => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = (0, Utils_1.decryptMediaRetryData)(result.media, mediaKey, result.key.id);
                                if (media.result !== WAProto_1.proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = WAProto_1.proto.MediaRetryNotification.ResultType[media.result];
                                    throw new boom_1.Boom(`Media re-upload failed by device (${resultStr})`, { data: media, statusCode: (0, Utils_1.getStatusCodeForMediaRetry)(media.result) || 404 });
                                }
                                content.directPath = media.directPath;
                                content.url = (0, Utils_1.getUrlFromDirectPath)(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            if (error) {
                throw error;
            }
            ev.emit('messages.update', [
                {
                    key: message.key,
                    update: {
                        message: message.message
                    }
                }
            ]);
            return message;
        },
        setLabelGroup: async (id, text) => {
            await relayMessage(id, {
                protocolMessage: {
                    type: 30,
                    memberLabel: {
                        label: text.slice(0, 30)
                    }
                }
            }, {
                additionalNodes: [
                    {
                        tag: "meta",
                        attrs: {
                            tag_reason: "user_update",
                            appdata: "member_tag"
                        },
                        content: undefined
                    }
                ]
            })
        },
        sendStatusMention: async (content, jids = []) => {
            return await ourin.sendStatusWhatsApp(content, jids);
        },
        sendMessage: async (jid, content, options = {}) => {
            const userJid = authState.creds.me.id;
            delete options.ephemeralExpiration
            const { filter = false, quoted } = options;
            const getParticipantAttr = () => filter ? { participant: { jid } } : {};
            const messageType = ourin.detectType(content);
            if (typeof content === 'object' && 'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' && WABinary_1.isJidGroup(jid)) {
                const { disappearingMessagesInChat } = content
                const value = typeof disappearingMessagesInChat === 'boolean' ?
                    (disappearingMessagesInChat ? Defaults_1.WA_DEFAULT_EPHEMERAL : 0) :
                    disappearingMessagesInChat
                await groupToggleEphemeral(jid, value)
            }
            else {
                let mediaHandle
                if (messageType) {
                    switch (messageType) {
                        case 'PAYMENT':
                            const paymentContent = await ourin.handlePayment(content, quoted);
                            return await relayMessage(jid, paymentContent, {
                                messageId: Utils_1.generateMessageID(),
                                ...getParticipantAttr()
                            });
                        case 'PRODUCT':
                            const productContent = await ourin.handleProduct(content, jid, quoted);
                            const productMsg = await Utils_1.generateWAMessageFromContent(jid, productContent, { quoted });
                            return await relayMessage(jid, productMsg.message, {
                                messageId: productMsg.key.id,
                                additionalNodes: Utils_1.buildInteractiveAdditionalNodes(jid, productMsg.message),
                                ...getParticipantAttr()
                            });
                        case 'INTERACTIVE':
                            const interactiveContent = await ourin.handleInteractive(content, jid, quoted);
                            const interactiveMsg = await Utils_1.generateWAMessageFromContent(jid, interactiveContent, { quoted });
                            return await relayMessage(jid, interactiveMsg.message, {
                                messageId: interactiveMsg.key.id,
                                additionalNodes: Utils_1.buildInteractiveAdditionalNodes(jid, interactiveMsg.message),
                                ...getParticipantAttr()
                            });
                        case 'INTERACTIVE_BUTTONS':
                            const ibContent = await ourin.handleInteractiveButtons(content, jid, quoted);
                            const ibMsg = await Utils_1.generateWAMessageFromContent(jid, ibContent, { quoted });
                            return await relayMessage(jid, ibMsg.message, {
                                messageId: ibMsg.key.id,
                                additionalNodes: Utils_1.buildInteractiveAdditionalNodes(jid, ibMsg.message),
                                ...getParticipantAttr()
                            });
                        case 'ALBUM':
                            return await ourin.handleAlbum(content, jid, quoted)
                        case 'EVENT':
                            return await ourin.handleEvent(content, jid, quoted)
                        case 'POLL_RESULT':
                            return await ourin.handlePollResult(content, jid, quoted)
                        case 'GROUP_STORY':
                            return await ourin.handleGroupStory(content, jid, quoted)
                        case 'NESTED_LIST': {
                            const nestedMsg = await ourin.handleNestedList(content, jid, quoted);
                            return await relayMessage(jid, nestedMsg.message, {
                                messageId: nestedMsg.key.id,
                                additionalNodes: Utils_1.buildInteractiveAdditionalNodes(jid, nestedMsg.message),
                                ...getParticipantAttr()
                            });
                        }
                        case 'MULTI_SELECT': {
                            const msContent = await ourin.handleMultiSelect(content, jid, quoted);
                            const msMsg = await Utils_1.generateWAMessageFromContent(jid, msContent, { quoted });
                            return await relayMessage(jid, msMsg.message, {
                                messageId: msMsg.key.id,
                                additionalNodes: Utils_1.buildInteractiveAdditionalNodes(jid, msMsg.message),
                                ...getParticipantAttr()
                            });
                        }
                    }
                }
                const fullMsg = await Utils_1.generateWAMessage(jid, content, {
                    logger,
                    userJid,
                    quoted,
                    getUrlInfo: text => link_preview_1.getUrlInfo(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: {
                            timeout: 3000,
                            ...axiosOptions || {}
                        },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    upload: async (readStream, opts) => {
                        const up = await waUploadToServer(readStream, {
                            ...opts,
                            newsletter: WABinary_1.isJidNewsLetter(jid)
                        });
                        return up;
                    },
                    mediaCache: config.mediaCache,
                    options: config.options,
                    ...options
                });
                const isDeleteMsg = 'delete' in content && !!content.delete;
                const isEditMsg = 'edit' in content && !!content.edit;
                const isAiMsg = 'ai' in content && !!content.ai;
                const additionalAttributes = {};
                const additionalNodes = [];
                if (isDeleteMsg) {
                    const fromMe = content.delete?.fromMe;
                    const isGroup = WABinary_1.isJidGroup(content.delete?.remoteJid);
                    additionalAttributes.edit = (isGroup && !fromMe) || WABinary_1.isJidNewsLetter(jid) ? '8' : '7';
                } else if (isEditMsg) {
                    additionalAttributes.edit = WABinary_1.isJidNewsLetter(jid) ? '3' : '1';
                } else if (isAiMsg) {
                    additionalNodes.push({
                        attrs: {
                            biz_bot: '1'
                        }, tag: "bot"
                    });
                }
                // Fix: si el contenido generado contiene botones/listas/carrusel nativos
                // enviados directamente (sin pasar por `ourin`), agregar los additionalNodes
                // que el cliente de WA necesita para renderizarlos (ver Utils/messages.js).
                const interactiveNodes = Utils_1.buildInteractiveAdditionalNodes(jid, fullMsg.message);
                if (interactiveNodes.length) {
                    additionalNodes.push(...interactiveNodes);
                }
                await relayMessage(jid, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    cachedGroupMetadata: options.cachedGroupMetadata,
                    additionalNodes: (isAiMsg || interactiveNodes.length) ? additionalNodes : options.additionalNodes,
                    additionalAttributes,
                    statusJidList: options.statusJidList
                });
                if (config.emitOwnEvents) {
                    process.nextTick(() => {
                        processingMutex.mutex(() => upsertMessage(fullMsg, 'append'));
                    });
                }
                return fullMsg;
            }
        },
        react(m, emoji = '') {
            const key = m?.quoted?.key || m?.key
            if (!key) throw new Error('No message key to react')

            return this.sendMessage(key.remoteJid, {
                react: {
                    text: emoji,
                    key
                }
            })
        },
        unreact(m) {
            const key = m?.quoted?.key || m?.key
            if (!key) throw new Error('No message key to react')

            return this.sendMessage(key.remoteJid, {
                react: {
                    text: '',
                    key
                }
            })
        },
        async delay(s) {
            if( s < 0 ) s = 0;
            const ms = s * 1000;
            return await new Promise(resolve => setTimeout(resolve, ms));
        },
        edit(m, newText) {
            if (!m?.key) throw new Error('Invalid message')
            return this.sendMessage(m.key.remoteJid, {
                edit: m.key,
                text: newText
            })
        },
        del(m) {
            if (!m?.key) throw new Error('Invalid message')
            return this.sendMessage(m.key.remoteJid, {
                delete: m.key
            })
        },
        detect(m) {
            if (!m?.message) return 'unknown'

            const msg = Utils_1.normalizeMessageContent(m.message)

            if (msg.reactionMessage) return 'reaction'
            if (msg.protocolMessage?.type === 0) return 'revoke'
            if (msg.protocolMessage?.editedMessage) return 'edited'

            if (msg.viewOnceMessageV2 || msg.viewOnceMessage) return 'viewonce'

            if (msg.imageMessage) return 'image'
            if (msg.videoMessage) return msg.videoMessage.gifPlayback ? 'gif' : 'video'
            if (msg.audioMessage) return msg.audioMessage.ptt ? 'ptt' : 'audio'
            if (msg.stickerMessage) return 'sticker'
            if (msg.documentMessage) return 'document'
            if (msg.contactMessage) return 'contact'
            if (msg.locationMessage || msg.liveLocationMessage) return 'location'
            if (msg.pollCreationMessage) return 'poll'
            if (msg.interactiveMessage) return 'interactive'
            if (msg.buttonsResponseMessage) return 'button_response'
            if (msg.listResponseMessage) return 'list_response'
            if (msg.extendedTextMessage || msg.conversation) return 'text'

            return 'unknown'
        },
        async forward(jid, m, options = {}) {
            if (!m?.message) throw new Error('Invalid message')
            const {
                force = false,
                removeContext = false
            } = options
            const msg = Utils_1.normalizeMessageContent(m.message)
            let content = JSON.parse(JSON.stringify(msg))
            if (removeContext) {
                const ctx =
                    content?.extendedTextMessage?.contextInfo ||
                    content?.imageMessage?.contextInfo ||
                    content?.videoMessage?.contextInfo ||
                    content?.documentMessage?.contextInfo

                if (ctx) delete ctx.quotedMessage
                if (ctx) delete ctx.participant
                if (ctx) delete ctx.stanzaId
                if (ctx) delete ctx.mentionedJid
            }
            const target =
                content.extendedTextMessage ||
                content.imageMessage ||
                content.videoMessage ||
                content.documentMessage
            if (target) {
                target.contextInfo = target.contextInfo || {}
                target.contextInfo.forwardingScore = force ? 999 : 1
                target.contextInfo.isForwarded = true
            }
            const fullMsg = await Utils_1.generateWAMessage(
                jid,
                content,
                {
                    logger,
                    userJid: authState.creds.me.id,
                    upload: waUploadToServer
                }
            )
            await relayMessage(jid, fullMsg.message, {
                messageId: fullMsg.key.id
            })
            return fullMsg
        },

        async resize(buf, width, height, {
            quality = 80,
        }) {
            const sharp = (await import('sharp')).default;
            return sharp(buf)
                .resize(width, height, { fit: 'inside' })
                .jpeg({ quality })
                .toBuffer();
        },

        async convert(buf, { to }) {
            const fmt = to.toLowerCase().replace('.', '');
            const IMG = { jpeg: 'jpeg', jpg: 'jpeg', png: 'png', webp: 'webp' };
            if (IMG[fmt]) {
                const sharp = (await import('sharp')).default;
                return sharp(buf).toFormat(IMG[fmt]).toBuffer();
            }
            const { spawn } = require('child_process');
            const args = ['-i', 'pipe:0', '-y'];
            if (fmt === 'mp4') args.push('-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4');
            else args.push('-f', fmt);
            args.push('pipe:1');
            return new Promise((resolve, reject) => {
                const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'ignore'] });
                const chunks = [];
                let len = 0;
                ff.stdout.on('data', c => { chunks.push(c); len += c.length; });
                ff.on('close', code => code === 0
                    ? resolve(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, len))
                    : reject(new Error(`Convert failed (${code})`))
                );
                ff.on('error', reject);
                ff.stdin.end(buf);
            });
        },

        async toSticker(buf, { quality = 80 } = {}) {
            const sharp = (await import('sharp')).default;
            return sharp(buf)
                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp({ quality })
                .toBuffer();
        },

        async compress(buf, { quality = 50 } = {}) {
            try {
                const sharp = (await import('sharp')).default;
                const { format } = await sharp(buf).metadata();
                if (format) return sharp(buf).toFormat(format, { quality }).toBuffer();
            } catch {}
            const { spawn } = require('child_process');
            const crf = String(Math.round(51 - (quality / 100 * 51)));
            return new Promise((resolve, reject) => {
                const ff = spawn('ffmpeg', [
                    '-i', 'pipe:0', '-y',
                    '-crf', crf, '-preset', 'ultrafast',
                    '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'
                ], { stdio: ['pipe', 'pipe', 'ignore'] });
                const chunks = [];
                let len = 0;
                ff.stdout.on('data', c => { chunks.push(c); len += c.length; });
                ff.on('close', code => code === 0
                    ? resolve(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, len))
                    : reject(new Error('Compress failed'))
                );
                ff.on('error', reject);
                ff.stdin.end(buf);
            });
        },

        async metadata(buf) {
            const result = { size: buf.length };
            try {
                const sharp = (await import('sharp')).default;
                const meta = await sharp(buf).metadata();
                if (meta.format) {
                    result.mimetype = `image/${meta.format}`;
                    result.width = meta.width;
                    result.height = meta.height;
                    result.channels = meta.channels;
                    result.hasAlpha = meta.hasAlpha;
                    return result;
                }
            } catch {}
            const { spawn } = require('child_process');
            return new Promise(resolve => {
                const ff = spawn('ffprobe', [
                    '-v', 'quiet', '-print_format', 'json',
                    '-show_format', '-show_streams', 'pipe:0'
                ], { stdio: ['pipe', 'pipe', 'ignore'] });
                const chunks = [];
                ff.stdout.on('data', c => chunks.push(c));
                ff.on('close', () => {
                    try {
                        const d = JSON.parse(Buffer.concat(chunks).toString());
                        const vid = d.streams?.find(s => s.codec_type === 'video');
                        const aud = d.streams?.find(s => s.codec_type === 'audio');
                        if (vid) { result.width = vid.width; result.height = vid.height; }
                        result.duration = parseFloat(d.format?.duration) || undefined;
                        result.mimetype = vid ? 'video/mp4' : aud ? 'audio/mpeg' : undefined;
                    } catch {}
                    resolve(result);
                });
                ff.on('error', () => resolve(result));
                ff.stdin.end(buf);
            });
        }

    }
};
exports.makeMessagesSocket = makeMessagesSocket;
