"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORY_GRADIENTS = exports.renderStoryCard = void 0;
const boom_1 = require("@hapi/boom");
/**
 * "Story card" renderizado por canvas — genera una imagen de status/story con estilo
 * (fondo degradado, título, cuerpo, pie de foto opcional) enteramente en JS vía Jimp
 * (peer dependency opcional, sin binarios nativos). Útil para posts de WhatsApp
 * Status / group story (`groupStatusMessageV2`) visualmente distintivos sin
 * necesidad de una herramienta de diseño externa.
 *
 * Importa `jimp` de forma perezosa (lazy) para que este módulo tenga costo cero /
 * dependencia dura cero para quienes nunca lo llaman.
 *
 * REQUIERE jimp v1.x (API con `new Jimp({width,height,color})`, `loadFont`,
 * `HorizontalAlign`, `measureTextHeight`). Instalar con: npm i jimp
 */
let _jimpLib;
const getJimp = async () => {
    if (_jimpLib)
        return _jimpLib;
    try {
        // @ts-ignore - optional peer dependency
        const core = require('jimp');
        // @ts-ignore - optional peer dependency submodule
        const fonts = require('jimp/fonts');
        _jimpLib = Object.assign({}, core, { fonts });
        return _jimpLib;
    }
    catch (_a) {
        throw new boom_1.Boom('renderStoryCard() requiere el peer dependency opcional "jimp" (v1.x). Instálalo con: npm i jimp', { statusCode: 500 });
    }
};
const DEFAULT_GRADIENTS = {
    sunset: [0xff7e5fff, 0xfeb47bff],
    purple: [0x8e2de2ff, 0x4a00e0ff],
    ocean: [0x2193b0ff, 0x6dd5edff],
    forest: [0x134e5eff, 0x71b280ff],
    midnight: [0x232526ff, 0x414345ff],
    fire: [0xf12711ff, 0xf5af19ff]
};
const lerpChannel = (a, b, t) => Math.round(a + (b - a) * t);
const lerpColor = (c1, c2, t, jimpLib) => {
    const { r: r1, g: g1, b: b1, a: a1 } = jimpLib.intToRGBA(c1);
    const { r: r2, g: g2, b: b2, a: a2 } = jimpLib.intToRGBA(c2);
    return jimpLib.rgbaToInt(lerpChannel(r1, r2, t), lerpChannel(g1, g2, t), lerpChannel(b1, b2, t), lerpChannel(a1, a2, t));
};
/**
 * Renderiza una story card con estilo y devuelve un buffer PNG.
 *
 * @param {object} opts
 * @param {string} [opts.title] - texto grande del título
 * @param {string} [opts.body] - subtítulo/cuerpo debajo del título
 * @param {string} [opts.footer] - línea pequeña de marca/pie fijada abajo
 * @param {'sunset'|'purple'|'ocean'|'forest'|'midnight'|'fire'} [opts.gradient='purple']
 * @param {[string|number, string|number]} [opts.colors] - [from, to] ARGB hex explícitos, sobreescribe `gradient`
 * @param {'vertical'|'diagonal'} [opts.direction='vertical']
 * @param {number} [opts.width=1080]
 * @param {number} [opts.height=1920]
 * @returns {Promise<Buffer>} buffer PNG, listo para pasar como `{ image: buffer }`
 */
const renderStoryCard = async (opts = {}) => {
    const jimpLib = await getJimp();
    const { Jimp, HorizontalAlign, VerticalAlign, loadFont, measureTextHeight, fonts } = jimpLib;
    const width = opts.width || 1080;
    const height = opts.height || 1920;
    const direction = opts.direction || 'vertical';
    const [from, to] = opts.colors || DEFAULT_GRADIENTS[opts.gradient] || DEFAULT_GRADIENTS.purple;
    const colorFrom = typeof from === 'string' ? parseInt(from.replace('#', ''), 16) : from;
    const colorTo = typeof to === 'string' ? parseInt(to.replace('#', ''), 16) : to;
    const image = new Jimp({ width, height, color: colorFrom });
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const t = direction === 'diagonal' ? (x / width + y / height) / 2 : y / height;
            image.setPixelColor(lerpColor(colorFrom, colorTo, t, jimpLib), x, y);
        }
    }
    const titleFont = await loadFont(fonts.SANS_64_WHITE);
    const bodyFont = await loadFont(fonts.SANS_32_WHITE);
    const footerFont = await loadFont(fonts.SANS_16_WHITE);
    const padding = Math.round(width * 0.08);
    const contentWidth = width - padding * 2;
    let cursorY = Math.round(height * 0.38);
    if (opts.title) {
        const titleHeight = measureTextHeight(titleFont, opts.title, contentWidth);
        image.print({
            font: titleFont,
            x: padding,
            y: cursorY,
            text: { text: opts.title, alignmentX: HorizontalAlign.LEFT, alignmentY: VerticalAlign.TOP },
            maxWidth: contentWidth
        });
        cursorY += titleHeight + Math.round(height * 0.03);
    }
    if (opts.body) {
        image.print({
            font: bodyFont,
            x: padding,
            y: cursorY,
            text: { text: opts.body, alignmentX: HorizontalAlign.LEFT, alignmentY: VerticalAlign.TOP },
            maxWidth: contentWidth
        });
    }
    if (opts.footer) {
        image.print({
            font: footerFont,
            x: padding,
            y: height - Math.round(height * 0.06),
            text: { text: opts.footer, alignmentX: HorizontalAlign.LEFT, alignmentY: VerticalAlign.TOP },
            maxWidth: contentWidth
        });
    }
    return image.getBuffer('image/png');
};
exports.renderStoryCard = renderStoryCard;
exports.STORY_GRADIENTS = Object.keys(DEFAULT_GRADIENTS);
