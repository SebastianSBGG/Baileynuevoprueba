
<div align="center">
  <img src="https://files.catbox.moe/sz835u.gif" width="200" alt="Cyberpunk Hacker GIF"/>

  <br><br>

  # 🚀 MancosBaileys
  
  **Una versión limpia, purificada y optimizada de Baileys para Bots de WhatsApp.**

  [![Node.js](https://img.shields.io/badge/Node.js-✓-43853d?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Baileys](https://img.shields.io/badge/Baileys-Custom_Fork-blue?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/jonathanggg/MancosBaileys)
  [![Dev](https://img.shields.io/badge/Made_With_By-JonathanG-ff69b4?style=for-the-badge)](https://github.com/jonathanggg)

  <img src="https://i.imgur.com/dBaSKWF.gif" height="20" width="100%" alt="Separador animado"/>
</div>

## 📌 ¿Qué es MancosBaileys?

**MancosBaileys** es un *fork* (bifurcación) personalizado de la popular librería `@whiskeysockets/baileys`. Fue creada específicamente para solucionar los problemas de las bases modificadas de terceros que inyectan publicidad molesta y secuestran las conexiones de los bots.

Esta versión está **100% limpia** y enfocada en la privacidad y el control total de tu entorno de desarrollo.

<div align="center">
  <img src="https://media.giphy.com/media/L8K62iDadQI6I/giphy.gif" width="400" alt="Code GIF"/>
</div>

<img src="https://i.imgur.com/dBaSKWF.gif" height="20" width="100%" alt="Separador animado"/>

## 🛠️ Instalación en tu Bot

Para utilizar **MancosBaileys** en tu bot (como KennyBot, MitaBot, etc.), no necesitas instalarlo desde `npm`. Lo vincularemos directamente a este repositorio.

### Paso 1: Modificar `package.json`
Abre el archivo `package.json` de tu bot y busca la dependencia de Baileys. Reemplázala por el enlace directo a este GitHub:

```json
"dependencies": {
  "@whiskeysockets/baileys": "github:jonathanggg/MancosBaileys"
}

```
### Paso 2: Limpieza e Instalación
Para asegurarte de que Node.js tome esta nueva versión purificada y borre cualquier rastro del Baileys modificado anterior, ejecuta estos comandos en la terminal de tu servidor o panel (Pterodactyl, Boxmine, etc.):
```bash
# 1. Elimina la carpeta actual de módulos
rm -rf node_modules

# 2. Reinstala las dependencias apuntando a tu GitHub
npm install

```
<img src="https://i.imgur.com/dBaSKWF.gif" height="20" width="100%" alt="Separador animado"/>
## 🤝 Créditos y Agradecimientos
 * Librería original creada por Whiskeysockets.
 * Purificación, parches y optimización por **JonathanG** / **Mancos y Asociados**.
<div align="center">


<img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&weight=600&size=20&pause=1000&color=00FF00&center=true&vCenter=true&width=435&lines=Desarrollando+el+futuro...;Mancos+Y+Asociados;KennyBot+MD+Rules!" alt="Typing SVG" />
</div>

