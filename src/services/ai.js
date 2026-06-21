/**
 * Mock Service que simula la respuesta de la IA.
 * Utilizado para desarrollo local rápido y pruebas offline sin requerir API keys.
 */
class MockAiService {
  async processAudio(audioBlob) {
    console.log("[MockAiService] Procesando audio simulado de", audioBlob.size, "bytes...");
    
    // Simulamos un delay de red/procesamiento de 2.5 segundos
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Retornamos un presupuesto de ejemplo variado
    return {
      clientName: "Juan Pérez",
      clientPhone: "11-2345-6789",
      clientEmail: "juan.perez@email.com",
      items: [
        { description: "Mano de obra: Pintura de living comedor (dos manos)", quantity: 1, unitPrice: 150000 },
        { description: "Lata de pintura látex Alba interior (20 Litros)", quantity: 1, unitPrice: 85000 },
        { description: "Pincel de cerda fina y rodillo antigota", quantity: 2, unitPrice: 12500 },
        { description: "Cinta de enmascarar azul (50 metros)", quantity: 3, unitPrice: 3200 },
        { description: "Plástico protector para pisos y muebles", quantity: 2, unitPrice: 5400 }
      ]
    };
  }
}

/**
 * Servicio real que conecta con la API de Google Gemini utilizando capacidades multimodales
 * para recibir el audio directamente y devolver un JSON estructurado de forma nativa.
 */
class GeminiAiService {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Transforma un Blob en base64 de manera asíncrona.
   */
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async processAudio(audioBlob) {
    console.log("[GeminiAiService] Transcribiendo y estructurando audio con Gemini...");
    
    const base64Audio = await this.blobToBase64(audioBlob);
    const mimeType = audioBlob.type || 'audio/ogg'; // Formato del MediaRecorder por defecto en mobile

    const promptText = `
      Analiza esta nota de voz donde un profesional describe un presupuesto para un trabajo o servicio.
      Extrae los siguientes datos:
      1. El nombre del cliente (si se menciona).
      2. Teléfono o email del cliente (si se mencionan).
      3. La lista detallada de los ítems del presupuesto: descripción clara en español, cantidad aproximada y precio unitario estimado.
      
      Si el audio no menciona precios unitarios específicos pero da un precio total por un conjunto,
      crea un único ítem con la descripción global del servicio y el monto total como precio unitario.
      Si no se mencionan cantidades, asume 1.
    `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`;
    
    const requestBody = {
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          {
            text: promptText
          }
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
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Error en API de Gemini (${response.status}): ${errText}`);
      }

      const responseData = await response.json();
      const textResponse = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!textResponse) {
        throw new Error("Gemini no retornó contenido parseable");
      }

      return JSON.parse(textResponse);
    } catch (error) {
      console.error("[GeminiAiService] Falló el procesamiento con Gemini:", error);
      throw error;
    }
  }
}

// Exportamos una instancia configurada dinámicamente según las variables de entorno
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
export const aiService = apiKey 
  ? new GeminiAiService(apiKey) 
  : new MockAiService();

console.log(`[AiService] Inicializado en modo: ${apiKey ? 'Gemini Real' : 'Mock (Costo 0 / Sin API Key)'}`);
