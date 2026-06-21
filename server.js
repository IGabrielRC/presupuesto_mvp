// Servidor Node.js / Express para el Bot de Telegram (Diseñado para EasyPanel en VPS)
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = process.env.PORT || 3000;

// Inicializamos el cliente de Supabase con Service Role para saltar políticas RLS al registrar bots
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Endpoint principal para el Webhook de Telegram
app.post('/telegram-bot', async (req, res) => {
  try {
    const update = req.body;
    console.log("Update recibido de Telegram:", JSON.stringify(update));

    const message = update.message;
    if (!message) {
      return res.status(200).send('OK');
    }

    const chatId = message.chat.id;
    const userId = String(message.from.id); // ID de usuario de Telegram del contratista

    // 1. Comando /start
    if (message.text && message.text.startsWith('/start')) {
      await handleStartCommand(chatId, userId, message.from.first_name);
      return res.status(200).send('OK');
    }

    // 2. Procesamiento de Notas de voz / Audio
    const voice = message.voice || message.audio;
    if (voice) {
      await processVoiceMessage(chatId, userId, voice);
    } else if (message.text) {
      await sendTelegramMessage(chatId, "¡Hola! Para armar un presupuesto, por favor **enviame una nota de voz** detallando los servicios o materiales.");
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error en webhook:", error.message);
    return res.status(200).send('OK'); // Respondemos 200 a Telegram para evitar reintentos infinitos
  }
});

// Endpoint de prueba de salud (Health Check)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`[Server] Bot Webhook corriendo en puerto ${PORT}`);
});

// --- ENTRADA / ONBOARDING ---
async function handleStartCommand(chatId, userId, firstName) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  const baseUrl = process.env.MINI_APP_URL || "https://tu-mini-app.com";

  if (!profile) {
    // Primera vez: Crear perfil inicial vacío
    await supabaseAdmin.from('profiles').insert({
      id: userId,
      company_name: `Empresa de ${firstName}`,
      default_terms: "Validez del presupuesto: 15 días."
    });

    const setupUrl = `${baseUrl}?u=${userId}`;

    await sendTelegramMessageWithButton(
      chatId,
      `¡Hola ${firstName}! Bienvenido a **VoiceBudget** 🎙️.\n\nPara empezar a mandar notas de voz y generar presupuestos profesionales, primero tenés que configurar los datos y el logo de tu empresa.`,
      "⚙️ Configurar Empresa",
      setupUrl
    );
  } else {
    await sendTelegramMessage(
      chatId,
      `¡Hola de nuevo, ${firstName}! Ya tenés tu perfil configurado.\n\nSimplemente **grabá una nota de voz** detallando el trabajo (ej: *"Pintar living de Juan, cobrarle 150 mil pesos de mano de obra y 50 mil de pintura Alba"*) y te armo el presupuesto en segundos.`
    );
  }
}

// --- PROCESAMIENTO MULTIMODAL GEMINI ---
async function processVoiceMessage(chatId, userId, voice) {
  const fileId = voice.file_id;
  const waitMessageId = await sendTelegramMessage(chatId, "🎙️ _Recibiendo nota de voz. Analizando con Gemini..._");

  try {
    // 1. Obtener la ruta del archivo de audio en la API de Telegram
    const fileResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    if (!fileData.ok) throw new Error("No se pudo obtener el archivo de Telegram.");

    const filePath = fileData.result.file_path;
    
    // 2. Descargar el archivo de audio (.ogg / .oga)
    const audioResponse = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
    const audioBuffer = await audioResponse.arrayBuffer();

    // 3. Consultar a la API de Gemini 1.5 Flash
    const extractedData = await callGeminiApi(audioBuffer, voice.mime_type || 'audio/ogg');
    console.log("Datos estructurados obtenidos de Gemini:", JSON.stringify(extractedData));

    // 4. Asegurar el perfil del contratista en Supabase
    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (!profile) {
      await supabaseAdmin.from('profiles').insert({ id: userId, company_name: "Mi Empresa" });
    }

    // 5. Insertar cabecera del presupuesto
    const { data: budget, error: bErr } = await supabaseAdmin
      .from('budgets')
      .insert({
        user_id: userId,
        client_name: extractedData.clientName || "Cliente Particular",
        client_phone: extractedData.clientPhone || "",
        client_email: extractedData.clientEmail || "",
        status: "draft"
      })
      .select()
      .single();

    if (bErr) throw bErr;

    // Insertar líneas de ítem
    const itemRows = (extractedData.items || []).map(item => ({
      budget_id: budget.id,
      description: item.description,
      quantity: item.quantity || 1,
      unit_price: item.unitPrice || 0
    }));

    if (itemRows.length > 0) {
      const { error: iErr } = await supabaseAdmin.from('budget_items').insert(itemRows);
      if (iErr) throw iErr;
    }

    // 6. Remover el mensaje de espera y enviar el botón de la Mini App
    await deleteTelegramMessage(chatId, waitMessageId);

    const baseUrl = process.env.MINI_APP_URL || "https://tu-mini-app.com";
    const editUrl = `${baseUrl}?u=${userId}&b=${budget.id}`;

    await sendTelegramMessageWithButton(
      chatId,
      `¡Presupuesto procesado con éxito! 📝\n\nCliente: *${budget.client_name}*\nSe detectaron *${itemRows.length}* ítems.\n\nTocá el botón de abajo para revisarlo, editar precios y compartir el link de pago/PDF.`,
      "✏️ Revisar Presupuesto",
      editUrl
    );

  } catch (error) {
    console.error("Error en proceso de audio:", error);
    await deleteTelegramMessage(chatId, waitMessageId);
    await sendTelegramMessage(chatId, `❌ No pude procesar tu nota de voz. Asegurate de hablar claro y nombrar los ítems y precios estimativos.\n\nError: ${error.message}`);
  }
}

// --- EXTRACTOR DE GEMINI ---
async function callGeminiApi(audioBuffer, mimeType) {
  // Convertir buffer a base64 (sintaxis Node.js)
  const base64Audio = Buffer.from(audioBuffer).toString('base64');
  const cleanMimeType = mimeType.split(';')[0];

  const promptText = `
    Analiza esta nota de voz donde un profesional describe un presupuesto para un trabajo o servicio.
    Extrae:
    1. El nombre del cliente (clientName).
    2. Teléfono (clientPhone) o email (clientEmail) del cliente si se mencionan.
    3. La lista detallada de los ítems del presupuesto (items): descripción, cantidad y precio unitario estimado.
    
    Si el audio no menciona precios unitarios específicos pero da un precio total por un conjunto,
    crea un único ítem con la descripción global del servicio y el monto total como precio unitario.
    Si no se mencionan cantidades, asume 1.
  `;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: cleanMimeType, data: base64Audio } },
          { text: promptText }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            clientName: { type: "STRING" },
            clientPhone: { type: "STRING" },
            clientEmail: { type: "STRING" },
            items: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  description: { type: "STRING" },
                  quantity: { type: "NUMBER" },
                  unitPrice: { type: "NUMBER" }
                },
                required: ["description", "quantity", "unitPrice"]
              }
            }
          },
          required: ["items"]
        }
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error: ${errText}`);
  }

  const result = await response.json();
  const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) throw new Error("Gemini no retornó contenido JSON estructurado.");
  
  return JSON.parse(textResponse);
}

// --- HELPER SENDERS ---
async function sendTelegramMessage(chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
  const data = await response.json();
  return data.result.message_id;
}

async function deleteTelegramMessage(chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  });
}

async function sendTelegramMessageWithButton(chatId, text, buttonText, webAppUrl) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          {
            text: buttonText,
            web_app: { url: webAppUrl }
          }
        ]]
      }
    })
  });
}
