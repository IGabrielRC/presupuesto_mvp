import { Budget } from './domain/Budget.js';
import { aiService } from './services/ai.js';
import { supabaseService } from './services/supabase.js';
import { PdfService } from './services/pdf.js';

// --- APPLICATION STATE ---
let currentBudget = null;
let currentProfile = null;
let currentUserId = 'user-123'; // ID por defecto si no viene en la URL
let isProfileSetupForced = false; // Bloquea el cierre si es la primera vez
let currentProfileLogoBase64 = null;

// Helper para convertir imagen externa a Base64 y bypassear CORS en html2canvas
const DEFAULT_LOGO_BASE64 = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiM4YTJiZTIiIHJ4PSIxNSIvPjxwYXRoIGQ9Ik0zMCA0MCBoNDAgdjMwIGgtNDAgeiBNNDAgNDAgdi0xMCBoMjAgdjEwIiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjQiLz48L3N2Zz4=";

async function getBase64Image(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("[App] No se pudo convertir logo a base64 (CORS):", e);
    return null; // Retornamos null para forzar el fallback al placeholder en el PDF
  }
}

async function cacheProfileLogoBase64(url) {
  if (!url) {
    currentProfileLogoBase64 = DEFAULT_LOGO_BASE64;
    return;
  }
  const base64 = await getBase64Image(url);
  currentProfileLogoBase64 = base64 || DEFAULT_LOGO_BASE64;
}

let mediaRecorder = null;
let audioChunks = [];
let recordingTimerInterval = null;
let recordingStartTime = null;

// --- DOM ELEMENTS ---
// Layout Containers
const editorContainer = document.getElementById('editor-container');
const viewerContainer = document.getElementById('viewer-container');
const printableCanvas = document.getElementById('printable-budget-canvas');

// Recovery Elements
const recoveryBanner = document.getElementById('recovery-banner');
const btnRecoveryClose = document.getElementById('btn-recovery-close');
const btnRecoveryLoad = document.getElementById('btn-recovery-load');
const btnRecoveryDiscard = document.getElementById('btn-recovery-discard');

// Profile Form Elements
const btnToggleProfile = document.getElementById('btn-toggle-profile');
const profilePanel = document.getElementById('profile-panel');
const btnCloseProfile = document.getElementById('btn-close-profile');
const profileForm = document.getElementById('profile-form');
const companyLogoInput = document.getElementById('company-logo');
const companyLogoFileInput = document.getElementById('company-logo-file');
const companyNameInput = document.getElementById('company-name');
const companyPhoneInput = document.getElementById('company-phone');
const companyEmailInput = document.getElementById('company-email');
const companyAddressInput = document.getElementById('company-address');
const companyTermsInput = document.getElementById('company-terms');

// Recorder Elements
const btnRecord = document.getElementById('btn-record');
const recordingStatus = document.getElementById('recording-status');
const recordingTimer = document.getElementById('recording-timer');
const fileUploadInput = document.getElementById('audio-file-upload');
const processingLoader = document.getElementById('processing-loader');
const loaderMessage = document.getElementById('loader-message');

// Editor Form Elements
const budgetEditorSection = document.getElementById('budget-editor-section');
const btnReRecord = document.getElementById('btn-re-record');
const clientNameInput = document.getElementById('client-name');
const clientPhoneInput = document.getElementById('client-phone');
const clientEmailInput = document.getElementById('client-email');
const editorItemsBody = document.getElementById('editor-items-body');
const btnAddItem = document.getElementById('btn-add-item');
const valSubtotal = document.getElementById('val-subtotal');
const valTaxRate = document.getElementById('val-tax-rate');
const valTaxAmount = document.getElementById('val-tax-amount');
const valTotal = document.getElementById('val-total');

// Sharing Panel Elements
const btnSaveShare = document.getElementById('btn-save-share');
const btnDownloadPdfLocal = document.getElementById('btn-download-pdf-local');
const sharePanel = document.getElementById('share-panel');
const shareLinkInput = document.getElementById('share-link-input');
const btnCopyLink = document.getElementById('btn-copy-link');
const btnShareWhatsapp = document.getElementById('btn-share-whatsapp');
const btnShareEmail = document.getElementById('btn-share-email');

// Viewer Elements (Client details)
const viewCompanyLogo = document.getElementById('view-company-logo');
const viewCompanyLogoPlaceholder = document.getElementById('view-company-logo-placeholder');
const viewCompanyName = document.getElementById('view-company-name');
const viewCompanyAddress = document.getElementById('view-company-address');
const viewCompanyPhone = document.getElementById('view-company-phone');
const viewCompanyEmail = document.getElementById('view-company-email');
const viewClientName = document.getElementById('view-client-name');
const viewClientPhone = document.getElementById('view-client-phone');
const viewClientEmail = document.getElementById('view-client-email');
const viewBudgetNumber = document.getElementById('view-budget-number');
const viewBudgetDate = document.getElementById('view-budget-date');
const viewStatusTag = document.getElementById('view-status-tag');
const viewItemsBody = document.getElementById('view-items-body');
const viewSubtotal = document.getElementById('view-subtotal');
const viewTaxPercentage = document.getElementById('view-tax-percentage');
const viewTaxAmount = document.getElementById('view-tax-amount');
const viewTotal = document.getElementById('view-total');
const viewCompanyTerms = document.getElementById('view-company-terms');
const btnViewerDownload = document.getElementById('btn-viewer-download');
const btnViewerBackEditor = document.getElementById('btn-viewer-back-editor');


// --- INITIALIZATION / ROUTING ---
window.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const clientBudgetId = urlParams.get('p');      // ?p=BUDGET_ID (Vista de cliente)
  const contractorUserId = urlParams.get('u');  // ?u=USER_ID (Editor / TMA)
  const budgetDraftId = urlParams.get('b');      // ?b=BUDGET_ID (Presupuesto a cargar/procesar)

  if (clientBudgetId) {
    // 1. Modo Visualizador de Cliente
    await loadClientViewer(clientBudgetId);
  } else {
    // 2. Modo Editor (Contratista / TMA)
    currentUserId = contractorUserId || 'user-123';
    await initEditorMode(budgetDraftId);
  }
});

// --- EDITOR MODE LOGIC ---
async function initEditorMode(budgetDraftId) {
  editorContainer.classList.remove('hidden');
  viewerContainer.classList.add('hidden');

  setupEditorEventListeners();

  showLoader("Cargando perfil de contratista...");
  try {
    // Cargar datos de empresa del usuario desde base de datos
    currentProfile = await supabaseService.getProfile(currentUserId);
    
    if (currentProfile) {
      prefillProfileForm(currentProfile);
      cacheProfileLogoBase64(currentProfile.logo_url); // Cachear de fondo
      isProfileSetupForced = false;
      btnCloseProfile.classList.remove('hidden');
    } else {
      // PRIMERA VEZ: Iniciado en modo libre para pruebas, sin forzar onboarding
      isProfileSetupForced = false;
      btnCloseProfile.classList.remove('hidden'); // Permitimos cerrar libremente
      profilePanel.classList.remove('hidden');
    }
  } catch (error) {
    console.error("Error al cargar perfil:", error);
  } finally {
    hideLoader();
  }

  // Si nos pasaron un ID de presupuesto borrador (ej: enviado desde el bot de Telegram)
  if (budgetDraftId) {
    await loadDraftBudget(budgetDraftId);
  } else {
    await checkForPendingDraft();
  }
}

async function checkForPendingDraft() {
  try {
    const draft = await supabaseService.getLatestDraft(currentUserId);
    if (draft) {
      recoveryBanner.classList.remove('hidden');
      
      btnRecoveryClose.onclick = () => {
        recoveryBanner.classList.add('hidden');
      };
      
      btnRecoveryLoad.onclick = () => {
        recoveryBanner.classList.add('hidden');
        loadDraftBudget(draft.id);
      };
      
      btnRecoveryDiscard.onclick = async () => {
        if (confirm("¿Estás seguro de que deseas descartar este borrador pendiente?")) {
          showLoader("Descartando borrador...");
          try {
            await supabaseService.cancelBudget(draft.id);
            recoveryBanner.classList.add('hidden');
          } catch (e) {
            console.error(e);
          } finally {
            hideLoader();
          }
        }
      };
    }
  } catch (error) {
    console.error("Error al buscar borrador pendiente:", error);
  }
}

function prefillProfileForm(profile) {
  if (profile.logo_url && profile.logo_url.startsWith('data:')) {
    companyLogoInput.value = "Imagen local subida (Base64)";
    currentProfileLogoBase64 = profile.logo_url;
  } else {
    companyLogoInput.value = profile.logo_url || '';
  }
  companyNameInput.value = profile.company_name || '';
  companyPhoneInput.value = profile.phone || '';
  companyEmailInput.value = profile.email || '';
  companyAddressInput.value = profile.address || '';
  companyTermsInput.value = profile.default_terms || '';
}

// Carga un borrador iniciado en Telegram
async function loadDraftBudget(budgetId) {
  showLoader("Cargando nota de voz desde Telegram...");
  try {
    const budgetData = await supabaseService.getBudget(budgetId);
    if (!budgetData) {
      alert("No se encontró el borrador del presupuesto.");
      return;
    }

    // Si viene de Telegram, simulamos que cargamos el archivo de audio subido
    // Para el MVP/Mock, si no hay archivo de audio físico, creamos ítems simulados de IA inmediatamente
    // en base al perfil del usuario actual
    console.log("[App] Procesando borrador de presupuesto:", budgetId);

    // Si ya tiene ítems en base de datos, los mostramos
    if (budgetData.items && budgetData.items.length > 0) {
      currentBudget = new Budget({
        id: budgetData.id,
        clientName: budgetData.client_name,
        clientPhone: budgetData.client_phone,
        clientEmail: budgetData.client_email,
        status: budgetData.status,
        items: budgetData.items,
        taxRate: Number(valTaxRate.value) / 100
      });
    } else {
      // Si está vacío (solo se mandó el audio desde Telegram), disparamos el procesador de IA
      // Mockeamos la nota de voz a procesar
      const mockAudioBlob = new Blob([new Uint8Array(1000)], { type: 'audio/ogg' });
      const extractedData = await aiService.processAudio(mockAudioBlob);
      
      currentBudget = new Budget({
        id: budgetId,
        clientName: extractedData.clientName || budgetData.client_name || '',
        clientPhone: extractedData.clientPhone || budgetData.client_phone || '',
        clientEmail: extractedData.clientEmail || budgetData.client_email || '',
        items: extractedData.items || [],
        taxRate: Number(valTaxRate.value) / 100
      });
    }

    // Rellenar inputs en el editor
    clientNameInput.value = currentBudget.clientName;
    clientPhoneInput.value = currentBudget.clientPhone;
    clientEmailInput.value = currentBudget.clientEmail;

    renderEditorItems();
    budgetEditorSection.classList.remove('hidden');
    budgetEditorSection.scrollIntoView({ behavior: 'smooth' });

  } catch (error) {
    console.error(error);
    alert("Error al cargar nota de voz: " + error.message);
  } finally {
    hideLoader();
  }
}

// --- EVENT LISTENERS ---
function setupEditorEventListeners() {
  // Panel de perfil de empresa
  btnToggleProfile.addEventListener('click', () => {
    if (!isProfileSetupForced) {
      profilePanel.classList.toggle('hidden');
    }
  });

  btnCloseProfile.addEventListener('click', () => {
    if (!isProfileSetupForced) {
      profilePanel.classList.add('hidden');
    }
  });

  btnReRecord.addEventListener('click', () => {
    // Hace scroll suave de vuelta a la sección de grabación
    const recSection = document.getElementById('recording-section');
    recSection.scrollIntoView({ behavior: 'smooth' });
    
    // Resalte temporario
    recSection.style.boxShadow = '0 0 35px var(--color-primary-glow)';
    setTimeout(() => {
      recSection.style.boxShadow = '';
    }, 2000);
  });
  
  // Manejar la subida manual de un archivo de logo
  companyLogoFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        currentProfileLogoBase64 = event.target.result;
        companyLogoInput.value = "Imagen local subida (Base64)";
      };
      reader.readAsDataURL(file);
    }
  });
  
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    let logoUrl = companyLogoInput.value;
    if (logoUrl === "Imagen local subida (Base64)" && currentProfileLogoBase64) {
      logoUrl = currentProfileLogoBase64;
    }

    const profileData = {
      company_name: companyNameInput.value,
      phone: companyPhoneInput.value,
      email: companyEmailInput.value,
      address: companyAddressInput.value,
      logo_url: logoUrl,
      default_terms: companyTermsInput.value
    };

    showLoader("Guardando datos de empresa...");
    try {
      currentProfile = await supabaseService.saveProfile(currentUserId, profileData);
      await cacheProfileLogoBase64(currentProfile.logo_url); // Cachear a base64
      isProfileSetupForced = false;
      btnCloseProfile.classList.remove('hidden'); // Permitir cierre ahora que se guardó
      profilePanel.classList.add('hidden');
      alert("¡Perfil de empresa configurado correctamente!");
      
      // Si el presupuesto ya estaba cargado, actualizamos la vista
      if (currentBudget) {
        syncDataToCanvas(currentBudget, currentProfile);
      }
    } catch (err) {
      alert("Error al guardar perfil: " + err.message);
    } finally {
      hideLoader();
    }
  });

  // Grabador de voz (Hold or click to record)
  btnRecord.addEventListener('mousedown', startRecording);
  btnRecord.addEventListener('mouseup', stopRecording);
  btnRecord.addEventListener('mouseleave', stopRecording);
  
  btnRecord.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startRecording();
  });
  btnRecord.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopRecording();
  });

  // Carga manual de audio
  fileUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      await processAudioFile(file);
    }
  });

  // Editor de Presupuestos - Agregar/editar ítems
  btnAddItem.addEventListener('click', () => {
    if (currentBudget) {
      currentBudget.addItem('', 1, 0);
      renderEditorItems();
    }
  });

  valTaxRate.addEventListener('input', () => {
    if (currentBudget) {
      currentBudget.taxRate = Number(valTaxRate.value) / 100;
      updateEditorTotals();
    }
  });

  clientNameInput.addEventListener('input', () => {
    if (currentBudget) currentBudget.clientName = clientNameInput.value;
  });
  clientPhoneInput.addEventListener('input', () => {
    if (currentBudget) currentBudget.clientPhone = clientPhoneInput.value;
  });
  clientEmailInput.addEventListener('input', () => {
    if (currentBudget) currentBudget.clientEmail = clientEmailInput.value;
  });

  // Descarga PDF local en el cliente
  btnDownloadPdfLocal.addEventListener('click', async () => {
    if (!currentBudget) return;
    
    // Validar que el perfil esté configurado
    if (isProfileSetupForced) {
      alert("Por favor guarda los datos de tu empresa primero.");
      profilePanel.classList.remove('hidden');
      profilePanel.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    showLoader("Generando PDF...");
    syncDataToCanvas(currentBudget, currentProfile);
    
    try {
      const filename = `Presupuesto_${currentBudget.clientName.replace(/\s+/g, '_') || 'Cliente'}.pdf`;
      await PdfService.downloadLocal(printableCanvas, filename);
    } catch (err) {
      alert("Error al descargar PDF: " + err.message);
    } finally {
      hideLoader();
    }
  });

  // Guardar en la nube y generar enlace para compartir
  btnSaveShare.addEventListener('click', saveAndGenerateLink);

  // Copiar link al portapapeles
  btnCopyLink.addEventListener('click', () => {
    shareLinkInput.select();
    document.execCommand('copy');
    btnCopyLink.textContent = "¡Copiado!";
    setTimeout(() => btnCopyLink.textContent = "Copiar", 2000);
  });
}

// --- RECORDING FUNCTIONS ---
async function startRecording() {
  if (isProfileSetupForced) {
    alert("Por favor completa los datos de tu empresa antes de grabar.");
    profilePanel.classList.remove('hidden');
    profilePanel.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') return;

  audioChunks = [];
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    let options = { mimeType: 'audio/webm' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) options = { mimeType: 'audio/ogg' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) options = { mimeType: 'audio/mp4' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) options = {};

    mediaRecorder = new MediaRecorder(stream, options);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/ogg' });
      stream.getTracks().forEach(track => track.stop());
      await processAudioFile(audioBlob);
    };

    mediaRecorder.start();
    recordingStartTime = Date.now();
    btnRecord.classList.add('recording');
    recordingStatus.textContent = "Grabando...";
    recordingStatus.classList.add('recording-active');
    
    recordingTimerInterval = setInterval(() => {
      const elapsedSecs = Math.floor((Date.now() - recordingStartTime) / 1000);
      const mins = String(Math.floor(elapsedSecs / 60)).padStart(2, '0');
      const secs = String(elapsedSecs % 60).padStart(2, '0');
      recordingTimer.textContent = `${mins}:${secs}`;
    }, 1000);

  } catch (err) {
    alert("No se pudo acceder al micrófono. Subí un archivo de audio directamente.");
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  
  mediaRecorder.stop();
  btnRecord.classList.remove('recording');
  recordingStatus.textContent = "Procesando...";
  recordingStatus.classList.remove('recording-active');
  
  clearInterval(recordingTimerInterval);
  recordingTimer.textContent = "00:00";
}

// --- AUDIO FILE PROCESSING ---
async function processAudioFile(audioBlob) {
  showLoader("Gemini está analizando la nota de voz...");
  try {
    const extractedData = await aiService.processAudio(audioBlob);
    
    currentBudget = new Budget({
      clientName: extractedData.clientName || '',
      clientPhone: extractedData.clientPhone || '',
      clientEmail: extractedData.clientEmail || '',
      items: extractedData.items || [],
      taxRate: Number(valTaxRate.value) / 100
    });

    clientNameInput.value = currentBudget.clientName;
    clientPhoneInput.value = currentBudget.clientPhone;
    clientEmailInput.value = currentBudget.clientEmail;

    renderEditorItems();
    budgetEditorSection.classList.remove('hidden');
    sharePanel.classList.add('hidden');
    budgetEditorSection.scrollIntoView({ behavior: 'smooth' });

  } catch (error) {
    alert("Hubo un error al procesar el audio: " + error.message);
  } finally {
    hideLoader();
  }
}

// --- TABLE RENDER & EVENT HANDLERS ---
function renderEditorItems() {
  editorItemsBody.innerHTML = '';
  
  currentBudget.items.forEach((item, index) => {
    const row = document.createElement('tr');
    
    row.innerHTML = `
      <td>
        <input type="text" class="input-desc" value="${item.description}" placeholder="Descripción del trabajo">
      </td>
      <td>
        <input type="number" class="input-qty text-right" value="${item.quantity}" step="any" min="0">
      </td>
      <td>
        <input type="number" class="input-price text-right" value="${item.unitPrice}" step="any" min="0">
      </td>
      <td class="text-right val-item-total" style="font-weight: 500;">
        ${Budget.formatCurrency(item.total)}
      </td>
      <td class="text-center">
        <button class="btn-remove-item" title="Eliminar ítem">&times;</button>
      </td>
    `;

    const descInput = row.querySelector('.input-desc');
    const qtyInput = row.querySelector('.input-qty');
    const priceInput = row.querySelector('.input-price');
    const btnRemove = row.querySelector('.btn-remove-item');

    descInput.addEventListener('input', () => {
      currentBudget.updateItem(index, { description: descInput.value });
    });

    const recalculateRow = () => {
      currentBudget.updateItem(index, {
        quantity: qtyInput.value,
        unitPrice: priceInput.value
      });
      row.querySelector('.val-item-total').textContent = Budget.formatCurrency(currentBudget.items[index].total);
      updateEditorTotals();
    };

    qtyInput.addEventListener('input', recalculateRow);
    priceInput.addEventListener('input', recalculateRow);
    
    btnRemove.addEventListener('click', () => {
      currentBudget.removeItem(index);
      renderEditorItems();
    });

    editorItemsBody.appendChild(row);
  });

  updateEditorTotals();
}

function updateEditorTotals() {
  valSubtotal.textContent = Budget.formatCurrency(currentBudget.subtotal);
  valTaxAmount.textContent = Budget.formatCurrency(currentBudget.taxAmount);
  valTotal.textContent = Budget.formatCurrency(currentBudget.total);
}

// --- SYNC DATA TO CANVAS TEMPLATE ---
function syncDataToCanvas(budget, profile) {
  const info = profile || {
    company_name: 'Tu Empresa / Nombre',
    phone: 'Tu Teléfono',
    email: 'Tu Correo',
    address: 'Tu Dirección',
    logo_url: '',
    default_terms: 'Condiciones de venta.'
  };

  viewCompanyName.textContent = info.company_name;
  viewCompanyAddress.textContent = info.address || 'Sin dirección';
  viewCompanyPhone.textContent = info.phone;
  viewCompanyEmail.textContent = info.email;

  if (currentProfileLogoBase64) {
    viewCompanyLogo.src = currentProfileLogoBase64;
    viewCompanyLogo.classList.remove('hidden');
    viewCompanyLogoPlaceholder.classList.add('hidden');
  } else if (info.logo_url) {
    viewCompanyLogo.src = info.logo_url;
    viewCompanyLogo.classList.remove('hidden');
    viewCompanyLogoPlaceholder.classList.add('hidden');
  } else {
    viewCompanyLogo.classList.add('hidden');
    viewCompanyLogoPlaceholder.classList.remove('hidden');
  }

  viewClientName.textContent = budget.clientName || 'Cliente Particular';
  viewClientPhone.textContent = budget.clientPhone || '-';
  viewClientEmail.textContent = budget.clientEmail || '-';

  viewBudgetNumber.textContent = `#${budget.id ? budget.id.substring(0, 8).toUpperCase() : 'BORRADOR'}`;
  
  const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  viewBudgetDate.textContent = budget.createdAt.toLocaleDateString('es-AR', dateOptions);

  viewStatusTag.textContent = budget.status;
  viewStatusTag.className = `status-tag ${budget.status}`;

  viewItemsBody.innerHTML = '';
  budget.items.forEach(item => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.description}</td>
      <td align="right">${item.quantity}</td>
      <td align="right">${Budget.formatCurrency(item.unitPrice)}</td>
      <td align="right" style="font-weight: 600;">${Budget.formatCurrency(item.total)}</td>
    `;
    viewItemsBody.appendChild(row);
  });

  viewSubtotal.textContent = Budget.formatCurrency(budget.subtotal);
  viewTaxPercentage.textContent = Math.round(budget.taxRate * 100);
  viewTaxAmount.textContent = Budget.formatCurrency(budget.taxAmount);
  viewTotal.textContent = Budget.formatCurrency(budget.total);

  viewCompanyTerms.textContent = info.default_terms || 'Sin condiciones particulares.';
}

// --- SAVE AND EXPORT ---
async function saveAndGenerateLink() {
  if (!currentBudget) return;
  
  if (isProfileSetupForced) {
    alert("Por favor completa los datos de tu empresa primero.");
    profilePanel.classList.remove('hidden');
    profilePanel.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  showLoader("Guardando presupuesto en la nube...");
  try {
    // 1. Guardar cabecera e ítems en la BD
    const budgetId = await supabaseService.createBudget(currentUserId, currentBudget, currentBudget.items);
    currentBudget.id = budgetId;

    syncDataToCanvas(currentBudget, currentProfile);

    // 2. Generar el PDF
    const pdfBlob = await PdfService.generateBlob(printableCanvas, `Presupuesto_${budgetId}.pdf`);

    // 3. Subir el PDF
    const publicPdfUrl = await supabaseService.uploadPdf(budgetId, pdfBlob);

    // 4. Actualizar la BD con la URL del PDF
    await supabaseService.updateBudgetPdf(budgetId, publicPdfUrl);
    
    currentBudget.pdfUrl = publicPdfUrl;
    currentBudget.status = 'sent';

    // 5. Configurar enlace para compartir
    const baseUrl = window.location.origin + window.location.pathname;
    const publicShareUrl = `${baseUrl}?p=${budgetId}`;
    
    shareLinkInput.value = publicShareUrl;
    
    const message = encodeURIComponent(`Hola! Te adjunto el presupuesto de ${currentProfile.company_name}: ${publicShareUrl}`);
    btnShareWhatsapp.onclick = () => {
      window.open(`https://wa.me/?text=${message}`, '_blank');
    };
    
    btnShareEmail.onclick = () => {
      window.open(`mailto:${currentBudget.clientEmail || ''}?subject=Presupuesto%20-%20${encodeURIComponent(currentProfile.company_name)}&body=${message}`, '_blank');
    };

    sharePanel.classList.remove('hidden');
    sharePanel.scrollIntoView({ behavior: 'smooth' });

  } catch (error) {
    console.error(error);
    alert("Error al guardar presupuesto: " + error.message);
  } finally {
    hideLoader();
  }
}

// --- LOAD CLIENT VIEW ---
async function loadClientViewer(budgetId) {
  editorContainer.classList.add('hidden');
  viewerContainer.classList.remove('hidden');
  
  showLoader("Cargando presupuesto oficial...");

  try {
    // Registrar métrica de lectura
    await supabaseService.logView(budgetId);

    const budgetData = await supabaseService.getBudget(budgetId);
    if (!budgetData) {
      document.body.innerHTML = `<div class="card glass-panel text-center" style="margin: 50px auto; max-width: 400px; padding: 40px;">
        <h2>Presupuesto No Encontrado</h2>
        <p class="text-muted">El enlace proporcionado no es válido o ha expirado.</p>
      </div>`;
      return;
    }

    const budget = new Budget({
      id: budgetData.id,
      clientName: budgetData.client_name,
      clientPhone: budgetData.client_phone,
      clientEmail: budgetData.client_email,
      status: budgetData.status,
      pdfUrl: budgetData.pdf_url,
      createdAt: new Date(budgetData.created_at),
      items: budgetData.items || []
    });

    const profile = budgetData.profile;
    if (profile) {
      await cacheProfileLogoBase64(profile.logo_url);
    }
    syncDataToCanvas(budget, profile);

    // Si el usuario que lo visualiza es el dueño, le permitimos volver a su editor
    // (Ejemplo para demo local con user-123, o si pasamos u en la sesión)
    const urlParams = new URLSearchParams(window.location.search);
    const editorUser = urlParams.get('u');
    
    if (editorUser || budgetData.user_id === 'user-123') {
      btnViewerBackEditor.classList.remove('hidden');
      btnViewerBackEditor.addEventListener('click', () => {
        window.location.href = `${window.location.pathname}?u=${editorUser || budgetData.user_id}`;
      });
    }

    btnViewerDownload.addEventListener('click', async () => {
      showLoader("Descargando PDF...");
      try {
        if (budget.pdfUrl && !budget.pdfUrl.startsWith('blob:')) {
          window.open(budget.pdfUrl, '_blank');
        } else {
          const filename = `Presupuesto_${budget.clientName.replace(/\s+/g, '_')}.pdf`;
          await PdfService.downloadLocal(printableCanvas, filename);
        }
      } catch (err) {
        alert("Error al descargar PDF: " + err.message);
      } finally {
        hideLoader();
      }
    });

  } catch (err) {
    console.error(err);
    alert("Hubo un error al cargar el presupuesto.");
  } finally {
    hideLoader();
  }
}

// --- UTILS ---
function showLoader(message) {
  loaderMessage.textContent = message;
  processingLoader.classList.remove('hidden');
}

function hideLoader() {
  processingLoader.classList.add('hidden');
}
