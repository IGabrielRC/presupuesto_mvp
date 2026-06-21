import html2pdf from 'html2pdf.js';

/**
 * Servicio para renderizar vistas HTML en documentos PDF y exportarlos.
 */
export class PdfService {
  /**
   * Toma un elemento del DOM, lo renderiza usando html2pdf y devuelve un Blob binario.
   * @param {HTMLElement} element - El elemento HTML que representa la factura/presupuesto.
   * @param {string} filename - Nombre sugerido del archivo.
   * @returns {Promise<Blob>} - El PDF en formato binario listo para subir.
   */
  static async generateBlob(element, filename = 'presupuesto.pdf') {
    console.log("[PdfService] Generando Blob del PDF a partir del elemento DOM...");
    
    const opt = {
      margin:       [15, 15, 20, 15], // márgenes en mm (arriba, izquierda, abajo, derecha)
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { 
        scale: 2, 
        useCORS: true, 
        logging: false,
        letterRendering: true
      },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    try {
      // Generar el PDF y obtener el blob
      const blob = await html2pdf()
        .set(opt)
        .from(element)
        .output('blob');

      return blob;
    } catch (error) {
      console.error("[PdfService] Error generando PDF:", error);
      throw error;
    }
  }

  /**
   * Descarga el PDF localmente en el dispositivo.
   * @param {HTMLElement} element 
   * @param {string} filename 
   */
  static async downloadLocal(element, filename = 'presupuesto.pdf') {
    const opt = {
      margin:       [15, 15, 20, 15],
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    return html2pdf().set(opt).from(element).save();
  }
}
