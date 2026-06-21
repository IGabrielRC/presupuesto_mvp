// Deno / Supabase Edge Function: telegram-bot/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // Rol de servicio para bypassear RLS en inserts automáticos

// Cliente de Supabase con permisos de administrador para guardar el borrador
const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Sólo se admiten peticiones POST", { status: 405 });
  }

  try {
    const update = await req.json();
    console.log("Update recibido de Telegram:", JSON.stringify(update));

    const message = update.message;
    if (!message) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userId = String(message.from.id); // ID único de Telegram del contratista

    // 1. Manejar comando /start (Onboarding)
    if (message.text && message.text.startsWith("/start")) {
      await handleStartCommand(chatId, userId, message.from.first_name);
      return new Response("OK", { status: 200 });
    }

    // 2. Procesar nota de voz (voice) o archivo de audio (audio)
    const voice = message.voice || message.audio;
    if (voice) {
      await processVoiceMessage(chatId, userId, voice);
    } else if (message.text) {
      // Respuesta por defecto si mandan texto común
      await sendTelegramMessage(chatId, "¡Hola! Para armar un presupuesto, por favor **enviame una nota de voz** detallando los servicios o materiales.");
    }

    return new Response("OK", { status: 200 });
  } catch (error: any) {
    console.error("Error procesando webhook:", error.message);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});

// --- MANEJO DE ONBOARDING (/start) ---
async function handleStartCommand(chatId: number, userId: string, firstName: string) {
  // Verificar si el perfil ya existe en la base de datos
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  const baseUrl = Deno.env.get("MINI_APP_URL") || "https://tu-mini-app-url.vercel.app";

  if (!profile) {
    // Primera vez: Creamos el registro del perfil vacío para asociarlo
    await supabaseAdmin.from("profiles").insert({
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
      `¡Hola de nuevo, ${firstName}! Ya tenés tu perfil configurado.\n\nSimplemente **grabá una nota de voz** detallando el trabajo (ej: *"Pintar living comedor de Juan, cobrarle 150 mil pesos de mano de obra y 50 mil de pintura Alba"*) y te armo el presupuesto en segundos.`
    );
  }
}

// --- PROCESAMIENTO DE NOTA DE VOZ ---
async function processVoiceMessage(chatId: number, userId: string, voice: any) {
  const fileId = voice.file_id;

  // Enviar mensaje de espera
  const waitMessageId = await sendTelegramMessage(chatId, "🎙️ _Recibiendo nota de voz. Analizando con Gemini..._");

  try {
    // 1. Obtener la ruta del archivo de audio de la API de Telegram
    const fileResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    if (!fileData.ok) throw new Error("No se pudo obtener la información del archivo en Telegram");

    const filePath = fileData.result.file_path;
    
    // 2. Descargar el archivo de audio (.ogg o .mp3)
    const audioResponse = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
    const audioBuffer = await audioResponse.arrayBuffer();

    // 3. Enviar a Gemini para transcripción y estructuración
    const extractedData = await callGeminiApi(audioBuffer, voice.mime_type || "audio/ogg");
    console.log("Datos extraídos por Gemini:", JSON.stringify(extractedData));

    // 4. Asegurar que el perfil exista (si por alguna razón borró el perfil o entró directo)
    const { data: profile } = await supabaseAdmin.from("profiles").select("*").eq("id", userId).single();
    if (!profile) {
      await supabaseAdmin.from("profiles").insert({ id: userId, company_name: "Mi Empresa" });
    }

    // 5. Guardar borrador en Supabase
    const { data: budget, error: bErr } = await supabaseAdmin
      .from("budgets")
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

    // Guardar ítems asociados
    const itemRows = (extractedData.items || []).map((item: any) => ({
      budget_id: budget.id,
      description: item.description,
      quantity: item.quantity || 1,
      unit_price: item.unitPrice || 0
    }));

    if (itemRows.length > 0) {
      const { error: iErr } = await supabaseAdmin.from("budget_items").insert(itemRows);
      if (iErr) throw iErr;
    }

    // 6. Eliminar mensaje de espera y mandar link de la Web App en Telegram
    await deleteTelegramMessage(chatId, waitMessageId);

    const baseUrl = Deno.env.get("MINI_APP_URL") || "https://tu-mini-app-url.vercel.app";
    const editUrl = `${baseUrl}?u=${userId}&b=${budget.id}`;

    await sendTelegramMessageWithButton(
      chatId,
      `¡Presupuesto procesado con éxito! 📝\n\nCliente: *${budget.client_name}*\nSe detectaron *${itemRows.length}* ítems.\n\nTocá el botón de abajo para revisarlo, editar precios y compartir el link de pago/PDF.`,
      "✏️ Revisar Presupuesto",
      editUrl
    );

  } catch (error: any) {
    console.error("Error en proceso de audio:", error);
    await deleteTelegramMessage(chatId, waitMessageId);
    await sendTelegramMessage(chatId, `❌ Lo siento, no pude procesar tu nota de voz. Asegúrate de hablar claro y mencionar los ítems y precios estimativos.\n\nError: ${error.message}`);
  }
}

// --- LLAMADA A GEMINI MULTIMODAL DESDE DENO ---
async function callGeminiApi(audioBuffer: ArrayBuffer, mimeType: string): Promise<any> {
  // Convertir buffer a base64
  const bytes = new Uint8Array(audioBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Audio = btoa(binary);

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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: mimeType.split(";")[0], data: base64Audio } },
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
  if (!textResponse) throw new Error("Gemini no retornó contenido JSON estructurado");
  
  return JSON.parse(textResponse);
}

// --- HELPERS API TELEGRAM ---
async function sendTelegramMessage(chatId: number, text: string): Promise<number> {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown"
    })
  });
  const data = await response.json();
  return data.result.message_id;
}

async function deleteTelegramMessage(chatId: number, messageId: number) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  });
}

async function sendTelegramMessageWithButton(chatId: number, text: string, buttonText: string, webAppUrl: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown",
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
