// boot.js
// Script principal do bot Node.js que atua como ponte para o Flask.

const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, isJidBroadcast, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const axios = require("axios");
const readline = require("readline");
const fs = require("fs").promises; // Importa o módulo 'fs' para operações de arquivo

// Adicionado Express para criar o servidor HTTP para o endpoint de envio externo
const express = require('express'); // <--- ADICIONE ESTA LINHA
const bodyParser = require('body-parser'); // <--- ADICIONE ESTA LINHA

// ✅ FLASK_WEBHOOK_URL: Esta constante será atualizada dinamicamente
let FLASK_WEBHOOK_URL = "http://localhost:4000/webhook"; // **AJUSTADO para a porta 4000 do seu Flask**

const AUTH_FILE_PATH = "auth_info_baileys"; // Caminho da pasta de autenticação
const CONFIG_FILE_PATH = "config.json"; // Novo arquivo para salvar a URL do Flask

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// --- NOVO: Configuração do servidor Express para o endpoint de envio externo ---
const app = express(); // <--- INICIA O EXPRESS
const EXTERNAL_API_PORT = 3000; // <--- PORTA ONDE O BOOT.JS VAI ESCUTAR PARA ENVIAR MENSAGENS (diferente do Flask 4000)
app.use(bodyParser.json()); // <--- PARA PARSEAR REQUISIÇÕES JSON
app.use(express.static('public')); // Se você tiver arquivos estáticos

// Endpoint para receber requisições do Flask para enviar mensagens para o WhatsApp
app.post('/enviar_mensagem_externa', async (req, res) => {
    const { actions, target_jid } = req.body; // target_jid é passado pelo Flask
    console.log(`\x1b[35m[API EXTERNA] Requisição de envio recebida para ${target_jid}. Ações:`, actions, '\x1b[0m'); // Magenta

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
        return res.status(400).json({ status: "error", message: "Nenhuma ação fornecida." });
    }

    try {
        const socketInstance = global.whatsAppSocket; // Recupera a instância do socket WhatsApp (definida abaixo)
        if (!socketInstance || !socketInstance.user) {
            console.error("\x1b[31m[API EXTERNA ERRO] Socket WhatsApp não conectado ou inválido.\x1b[0m");
            return res.status(500).json({ status: "error", message: "Bot WhatsApp não está conectado." });
        }

        for (const action of actions) {
            // No caso de send_to_jid, a ação já deve ter o target_jid correto.
            // Para outras ações (text, image_b64, quick_reply), o target_jid virá do payload raiz.
            const recipientJid = action.target_jid || target_jid; // Prioriza o JID da ação, senão usa o do payload raiz

            if (!recipientJid) {
                console.error("\x1b[31m[API EXTERNA ERRO] JID do destinatário não especificado na ação nem no payload raiz.\x1b[0m");
                continue; // Pula para a próxima ação se o JID estiver faltando
            }

            // A lógica de "digitando..." e delay para o envio externo é diferente:
            // O delay aqui não significa esperar *antes* de enviar a mensagem,
            // mas sim que o *gateway* deve simular um atraso no *envio* da mensagem.
            // Para este cenário, como estamos focando em "disparar e esquecer" do Flask,
            // o Flask não espera por este delay.
            if (action.delay && (action.type === "text" || action.type === "image_b64" || action.type === "quick_reply")) {
                await socketInstance.sendPresenceUpdate('composing', recipientJid); // Ativa o "digitando..."
                await new Promise(resolve => setTimeout(resolve, action.delay)); // Espera o delay
                await socketInstance.sendPresenceUpdate('paused', recipientJid); // Desativa o "digitando..."
            }

            switch (action.type) {
                case "text":
                    await socketInstance.sendMessage(recipientJid, { text: action.content });
                    break;
                case "image_b64":
                    const imageBuffer = Buffer.from(action.content, "base64");
                    await socketInstance.sendMessage(recipientJid, { image: imageBuffer, caption: action.caption || "" });
                    break;
                case "send_to_jid": // Flask está usando isso para o envio final
                    // Este case já é tratado pelo recipientJid acima.
                    await socketInstance.sendMessage(recipientJid, { text: action.content });
                    break;
                case "quick_reply":
                    const buttonList = action.buttons.map(button => ({
                        quickReplyButton: {
                            displayText: button.text,
                            id: button.id
                        }
                    }));
                    const buttonMessageSimple = {
                        text: action.content,
                        footer: action.footer || '',
                        templateButtons: buttonList,
                        type: 'buttonsMessage'
                    };
                    await socketInstance.sendMessage(recipientJid, buttonMessageSimple);
                    break;
                default:
                    console.warn(`\x1b[33m[API EXTERNA AVISO] Tipo de ação desconhecido: ${action.type}\x1b[0m`);
                    break;
            }
        }
        res.json({ status: "success", message: "Mensagens processadas para envio." });
    } catch (error) {
        console.error(`\x1b[31m[API EXTERNA ERRO] Falha ao enviar mensagem pelo socket WhatsApp:`, error.message, '\x1b[0m');
        res.status(500).json({ status: "error", message: "Erro ao enviar mensagem pelo bot." });
    }
});

// Inicia o servidor Express para a API externa
app.listen(EXTERNAL_API_PORT, () => {
    console.log(`\x1b[36mAPI Externa do Bot escutando em http://localhost:${EXTERNAL_API_PORT}\x1b[0m`); // Ciano
});
// --- FIM NOVO: Configuração do servidor Express ---


// Função para exibir a tela de carregamento
function showLoadingScreen() {
    console.clear(); // Limpa o terminal
    console.log("\n");
    console.log("██████╗  ██████╗ ████████╗ ██████╗  █████╗  ██████╗ ███████╗");
    console.log("██╔══██╗██╔═══██╗╚══██╔══╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝");
    console.log("██████╔╝██║   ██║   ██║   ██║   ██║███████║██║  ███╗█████╗  ");
    console.log("██╔══██╗██║   ██║   ██║   ██║   ██║██╔══██║██║   ██║██╔══╝  ");
    console.log("██████╔╝╚██████╔╝   ██║   ╚██████╔╝██║  ██║╚██████╔╝███████╗");
    console.log("╚════╝  ╚════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝");
    console.log("\n");
    console.log("\x1b[33m           Iniciando bot e conectando ao WhatsApp...\x1b[0m"); // Amarelo
    console.log("\x1b[33m               Aguarde um momento, por favor.\x1b[0m"); // Amarelo
    console.log("\n");
}

// Função para exibir o status ONLINE de forma bonita
function showConnectedStatus(botNumber) {
    console.clear(); // Limpa o terminal antes de mostrar o status
    console.log("\n");
    console.log("█▀▀ █▀█ █▀▀ ▀█▀ █ █▄░█ █▀▀ █▀");
    console.log("█▄▄ █▀▄ ██▄ ░█░ █ █░▀█ ██▄ ▄█");
    console.log("\n");
    console.log(`\x1b[32m           BOT ONLINE E PRONTO PARA USO!\x1b[0m`); // Verde
    if (botNumber) {
        console.log(`\x1b[32m           Conectado como: ${botNumber}\x1b[0m`); // Verde
    }
    console.log(`\x1b[36m           URL do Flask: ${FLASK_WEBHOOK_URL}\x1b[0m`); // Ciano
    console.log(`\x1b[36m           API Externa para Envio: http://localhost:${EXTERNAL_API_PORT}/enviar_mensagem_externa\x1b[0m`); // Ciano
    console.log("\n");
    console.log("Aguardando mensagens do WhatsApp e comunicando com o Flask...");
    console.log("\n");
}

// Função para limpar as credenciais de autenticação
async function clearAuthFiles() {
    try {
        await fs.rm(AUTH_FILE_PATH, { recursive: true, force: true });
        console.log(`\x1b[33mPasta '${AUTH_FILE_PATH}' removida com sucesso. Preparando para nova conexão.\x1b[0m`);
    } catch (error) {
        // Ignora erro se a pasta não existir
        if (error.code !== 'ENOENT') {
            console.error("\x1b[31mErro ao remover a pasta de autenticação:", error.message, "\x1b[0m");
        }
    }
}

// Função para carregar a configuração da URL do Flask
async function loadConfig() {
    try {
        const data = await fs.readFile(CONFIG_FILE_PATH, 'utf8');
        const config = JSON.parse(data);
        if (config.flaskWebhookUrl) {
            FLASK_WEBHOOK_URL = config.flaskWebhookUrl;
            console.log(`\x1b[34mURL do Flask carregada de '${CONFIG_FILE_PATH}': ${FLASK_WEBHOOK_URL}\x1b[0m`); // Azul
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log("\x1b[33mArquivo de configuração não encontrado. Usando URL padrão ou a última definida.\x1b[0m"); // Amarelo
        } else {
            console.error("\x1b[31mErro ao carregar configuração:", error.message, "\x1b[0m"); // Vermelho
        }
    }
}

// Função para salvar a configuração da URL do Flask
async function saveConfig() {
    try {
        const config = { flaskWebhookUrl: FLASK_WEBHOOK_URL };
        await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
        console.log(`\x1b[32mURL do Flask salva em '${CONFIG_FILE_PATH}'.\x1b[0m`); // Verde
    } catch (error) {
        console.error("\x1b[31mErro ao salvar configuração:", error.message, "\x1b[0m"); // Vermelho
    }
}

async function connectToWhatsApp(isNewConnection = false) {
    showLoadingScreen(); // Mostra a tela de carregamento antes de tentar conectar

    if (isNewConnection) {
        await clearAuthFiles();
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FILE_PATH);

    const socket = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false
    });

    // Torna a instância do socket WhatsApp acessível globalmente para o endpoint Express
    global.whatsAppSocket = socket; // <--- ADICIONE ESTA LINHA

    if (!socket.authState.creds.registered) {
        const phoneNumber = await question("\nPor favor, digite o número do WhatsApp que você está conectando (formato 55119...): ");
        const code = await socket.requestPairingCode(phoneNumber);
        console.clear(); // Limpa após pedir o número para mostrar o QR code mais limpo
        console.log(`\n✅ SEU CÓDIGO DE CONEXÃO É: ${code}\n`);
        console.log("Abra o WhatsApp no seu celular, vá em 'Aparelhos Conectados' > 'Conectar um aparelho' > 'Conectar com número de telefone' e digite o código acima.");
    }

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                console.log("\x1b[33mConexão fechada. Tentando reconectar...\x1b[0m"); // Amarelo
                connectToWhatsApp();
            } else {
                console.log('\x1b[31mNão foi possível reconectar. Apague a pasta "auth_info_baileys" e tente novamente para uma nova conexão.\x1b[0m'); // Vermelho
                socket.ev.removeAllListeners(); // Limpa listeners para evitar duplicação em novo menu
                mainMenu(); // Volta ao menu principal após um logout intencional ou falha irreversível
            }
        } else if (connection === "open") {
            const botNumber = socket.user.id.split(":")[0];
            showConnectedStatus(botNumber); // Exibe o status ONLINE bonito
        }
    });

    socket.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || isJidBroadcast(msg.key.remoteJid)) return;

        try {
            const senderId = msg.key.remoteJid;
            const pushName = msg.pushName || "";
            const messageType = Object.keys(msg.message)[0];
            let payload = {
                senderId,
                pushName,
                messageType,
                text: "",
                imageData: null,
                timestamp: msg.messageTimestamp
            };

            // NOVO: Verifica se a mensagem é um clique de botão de resposta rápida
            if (messageType === 'buttonsResponseMessage') {
                payload.text = msg.message.buttonsResponseMessage.selectedButtonId;
                payload.messageType = 'quickReplyButton'; // Tipo personalizado para identificar no Flask
            } else if (messageType === "conversation") {
                payload.text = msg.message.conversation;
            } else if (messageType === "extendedTextMessage") {
                payload.text = msg.message.extendedTextMessage.text;
            } else if (messageType === "imageMessage") {
                payload.text = msg.message.imageMessage.caption || "";
                const stream = await downloadContentFromMessage(msg.message.imageMessage, "image");
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                payload.imageData = buffer.toString("base64");
            } else {
                return;
            }

            const response = await axios.post(FLASK_WEBHOOK_URL, payload);
            const actions = response.data.actions || [];

            for (const action of actions) {
                // Ativa o "digitando..." se a ação tiver um 'delay' especificado
                if (action.delay && (action.type === "text" || action.type === "image_b64" || action.type === "quick_reply")) {
                    await socket.sendPresenceUpdate('composing', senderId); // Ativa o "digitando..."
                    await new Promise(resolve => setTimeout(resolve, action.delay)); // Espera o delay (passado pelo Flask)
                    await socket.sendPresenceUpdate('paused', senderId); // Desativa o "digitando..."
                }

                switch (action.type) {
                    case "text":
                        await socket.sendMessage(senderId, { text: action.content });
                        break;
                    case "image_b64":
                        const imageBuffer = Buffer.from(action.content, "base64");
                        await socket.sendMessage(senderId, { image: imageBuffer, caption: action.caption || "" });
                        break;
                    case "send_to_jid":
                        // Este case agora é usado principalmente pelo Flask para enviar mensagens
                        // para JIDs específicos (como o motoboy) ou para a resposta final do OCR.
                        // O 'target_jid' para esta ação já virá do Flask.
                        await socket.sendMessage(action.target_jid, { text: action.content });
                        break;
                    case "quick_reply": // Lida com a resposta de botões de resposta rápida
                        // NOVO FORMATO: Mais direto para botões de resposta rápida simples (Baileys)
                        const buttonList = action.buttons.map(button => ({
                            quickReplyButton: {
                                displayText: button.text,
                                id: button.id
                            }
                        }));

                        const buttonMessageSimple = {
                            text: action.content, // O texto principal da mensagem
                            footer: action.footer || '', // Pode adicionar um rodapé se quiser (opcional)
                            templateButtons: buttonList,
                            type: 'buttonsMessage' // Este tipo é para mensagens com botões no Baileys
                        };
                        await socket.sendMessage(senderId, buttonMessageSimple);
                        break;
                    default:
                        break;
                }
            }

        } catch (error) {
            console.error(`\x1b[31m[BOT ERRO CRÍTICO] Falha ao processar mensagem ou comunicar com Flask para ${msg.key.remoteJid}.\x1b[0m`); // Vermelho
            if (error.response) {
                console.error(`\x1b[31m  Status HTTP: ${error.response.status}. Dados: ${JSON.stringify(error.response.data)}\x1b[0m`);
            } else if (error.request) {
                console.error(`\x1b[31m  Não houve resposta do Flask. Verifique se o Flask está online e a URL está correta: ${FLASK_WEBHOOK_URL}\x1b[0m`);
            } else {
                console.error(`\x1b[31m  Mensagem de erro: ${error.message}\x1b[0m`);
            }
        }
    });
}

// Função para editar o URL do Flask
async function editFlaskUrl() {
    console.clear();
    console.log("\n--- EDITA URL DO FLASK ---");
    console.log(`URL atual: \x1b[36m${FLASK_WEBHOOK_URL}\x1b[0m`); // Ciano
    const newUrl = await question("Digite a NOVA URL/IP do Flask (ex: http://meuapp.ngrok.io/webhook): ");

    if (newUrl && newUrl.trim() !== '') {
        FLASK_WEBHOOK_URL = newUrl.trim();
        await saveConfig(); // Salva a nova URL
        console.log("\x1b[32mURL atualizada com sucesso!\x1b[0m"); // Verde
        console.log("\x1b[33mReiniciando o bot para aplicar as alterações...\x1b[0m"); // Amarelo
        // Pequeno atraso antes de reiniciar para a mensagem ser lida
        await new Promise(resolve => setTimeout(resolve, 2000));
        process.exit(0); // Reinicia o processo Node.js
    } else {
        console.log("\x1b[31mURL inválida. Nenhuma alteração foi feita.\x1b[0m"); // Vermelho
        await new Promise(resolve => setTimeout(resolve, 1500));
        mainMenu(); // Volta para o menu
    }
}


// Função do menu principal
async function mainMenu() {
    console.clear();
    console.log("\n");
    console.log("██╗  ██╗██╗███████╗███████╗██████╗  ██████╗ ████████╗");
    console.log("██║  ██║██║██╔════╝██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝");
    console.log("███████║██║█████╗  █████╗  ██████╔╝██║   ██║   ██║   ");
    console.log("██╔══██║██║██╔══╝  ██╔══╝  ██╔══██╗██║   ██║   ██║   ");
    console.log("██║  ██║██║███████╗███████╗██║  ██║╚██████╔╝   ██║   ");
    console.log("╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ");
    console.log("\n");
    console.log(`URL do Flask atual: \x1b[36m${FLASK_WEBHOOK_URL}\x1b[0m`); // Ciano
    console.log("\nEscolha uma opção:");
    console.log("1. Conectar WhatsApp existente / Iniciar bot");
    console.log("2. Conectar NOVO WhatsApp (apaga credenciais atuais)");
    console.log("3. \x1b[35mEditar URL/IP do Flask\x1b[0m"); // Magenta
    console.log("4. Sair");
    console.log("\n");

    const choice = await question("Digite o número da opção desejada: ");

    switch (choice) {
        case "1":
            connectToWhatsApp(false);
            break;
        case "2":
            connectToWhatsApp(true);
            break;
        case "3":
            editFlaskUrl(); // Chama a nova função de edição
            break;
        case "4":
            console.log("Saindo do HiperBoot. Até mais!");
            rl.close(); // Fecha a interface readline
            process.exit(0);
            break;
        default:
            console.log("\nOpção inválida. Tente novamente.");
            await new Promise(resolve => setTimeout(resolve, 1500));
            mainMenu();
            break;
    }
}

// Inicia o bot carregando a configuração e depois mostrando o menu principal
(async () => {
    await loadConfig(); // Carrega a URL salva antes de qualquer coisa
    mainMenu();
})();
