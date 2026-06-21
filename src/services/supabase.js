import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Verificamos si tenemos las credenciales para conectar a Supabase real
const isRealSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Fallback de UUID para contextos HTTP inseguros en celulares local
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Cliente de Base de Datos y Almacenamiento que conmuta automáticamente entre
 * un motor en LocalStorage (costo 0, cero fricción al instalar) y la API real de Supabase.
 */
class SupabaseService {
  constructor() {
    if (isRealSupabaseConfigured) {
      console.log("[SupabaseService] Inicializado usando Supabase Cloud.");
      this.client = createClient(supabaseUrl, supabaseAnonKey);
    } else {
      console.warn("[SupabaseService] Credenciales ausentes. Usando LocalStorage Mock Database.");
      this.client = null;
      this._initLocalStorageMock();
    }
  }

  _initLocalStorageMock() {
    if (!localStorage.getItem('tb_profiles')) {
      // Perfil de prueba por defecto
      localStorage.setItem('tb_profiles', JSON.stringify({
        'user-123': {
          company_name: 'Pinturas y Reformas RG',
          phone: '+54 11 9876-5432',
          email: 'contacto@reformasrg.com',
          address: 'Av. Corrientes 1234, CABA',
          logo_url: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=100&h=100&fit=crop',
          default_terms: 'Validez del presupuesto: 15 días. Forma de pago: 50% anticipo, 50% contra entrega.'
        }
      }));
    }
    if (!localStorage.getItem('tb_budgets')) localStorage.setItem('tb_budgets', JSON.stringify({}));
    if (!localStorage.getItem('tb_budget_items')) localStorage.setItem('tb_budget_items', JSON.stringify({}));
    if (!localStorage.getItem('tb_budget_views')) localStorage.setItem('tb_budget_views', JSON.stringify([]));
  }

  // --- PROFILE METHODS ---

  async getProfile(userId = 'user-123') {
    if (this.client) {
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } else {
      const profiles = JSON.parse(localStorage.getItem('tb_profiles'));
      return profiles[userId] || null;
    }
  }

  async saveProfile(userId = 'user-123', profileData) {
    if (this.client) {
      const { data, error } = await this.client
        .from('profiles')
        .upsert({ id: userId, ...profileData })
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const profiles = JSON.parse(localStorage.getItem('tb_profiles'));
      profiles[userId] = { ...profiles[userId], ...profileData };
      localStorage.setItem('tb_profiles', JSON.stringify(profiles));
      return profiles[userId];
    }
  }

  // --- BUDGET METHODS ---

  async getBudget(budgetId) {
    if (this.client) {
      // Obtenemos cabecera
      const { data: budget, error: bErr } = await this.client
        .from('budgets')
        .select('*')
        .eq('id', budgetId)
        .single();
      if (bErr) throw bErr;

      // Obtenemos ítems
      const { data: items, error: iErr } = await this.client
        .from('budget_items')
        .select('*')
        .eq('budget_id', budgetId);
      if (iErr) throw iErr;

      // Obtenemos perfil del emisor
      const profile = await this.getProfile(budget.user_id);

      return { ...budget, items, profile };
    } else {
      const budgets = JSON.parse(localStorage.getItem('tb_budgets'));
      const items = JSON.parse(localStorage.getItem('tb_budget_items'));
      const profiles = JSON.parse(localStorage.getItem('tb_profiles'));

      const budget = budgets[budgetId];
      if (!budget) return null;

      const budgetItems = Object.values(items).filter(it => it.budget_id === budgetId);
      const profile = profiles[budget.user_id] || {};

      return { ...budget, items: budgetItems, profile };
    }
  }

  async createBudget(userId = 'user-123', budgetData, itemsList) {
    const budgetId = this.client ? null : generateUUID();

    if (this.client) {
      // 1. Guardar cabecera
      const { data: budget, error: bErr } = await this.client
        .from('budgets')
        .insert({
          user_id: userId,
          client_name: budgetData.clientName,
          client_phone: budgetData.clientPhone,
          client_email: budgetData.clientEmail,
          status: budgetData.status || 'draft'
        })
        .select()
        .single();
      if (bErr) throw bErr;

      // 2. Guardar ítems
      const rows = itemsList.map(item => ({
        budget_id: budget.id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice
      }));

      const { error: iErr } = await this.client
        .from('budget_items')
        .insert(rows);
      if (iErr) throw iErr;

      return budget.id;
    } else {
      const budgets = JSON.parse(localStorage.getItem('tb_budgets'));
      const items = JSON.parse(localStorage.getItem('tb_budget_items'));

      budgets[budgetId] = {
        id: budgetId,
        user_id: userId,
        client_name: budgetData.clientName,
        client_phone: budgetData.clientPhone,
        client_email: budgetData.clientEmail,
        status: budgetData.status || 'draft',
        pdf_url: null,
        created_at: new Date().toISOString()
      };

      itemsList.forEach((item, idx) => {
        const itemId = `${budgetId}-${idx}`;
        items[itemId] = {
          id: itemId,
          budget_id: budgetId,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice
        };
      });

      localStorage.setItem('tb_budgets', JSON.stringify(budgets));
      localStorage.setItem('tb_budget_items', JSON.stringify(items));
      return budgetId;
    }
  }

  async updateBudgetPdf(budgetId, pdfUrl) {
    if (this.client) {
      const { error } = await this.client
        .from('budgets')
        .update({ pdf_url: pdfUrl, status: 'sent' })
        .eq('id', budgetId);
      if (error) throw error;
    } else {
      const budgets = JSON.parse(localStorage.getItem('tb_budgets'));
      if (budgets[budgetId]) {
        budgets[budgetId].pdf_url = pdfUrl;
        budgets[budgetId].status = 'sent';
        localStorage.setItem('tb_budgets', JSON.stringify(budgets));
      }
    }
  }

  async getLatestDraft(userId) {
    if (this.client) {
      const { data, error } = await this.client
        .from('budgets')
        .select('id, client_name, created_at')
        .eq('user_id', userId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      const budgets = JSON.parse(localStorage.getItem('tb_budgets')) || {};
      const draft = Object.values(budgets)
        .filter(b => b.user_id === userId && b.status === 'draft')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      return draft || null;
    }
  }

  async cancelBudget(budgetId) {
    if (this.client) {
      const { error } = await this.client
        .from('budgets')
        .update({ status: 'cancelled' })
        .eq('id', budgetId);
      if (error) throw error;
    } else {
      const budgets = JSON.parse(localStorage.getItem('tb_budgets')) || {};
      if (budgets[budgetId]) {
        budgets[budgetId].status = 'cancelled';
        localStorage.setItem('tb_budgets', JSON.stringify(budgets));
      }
    }
  }

  // --- STORAGE (PDF UPLOAD) ---

  async uploadPdf(budgetId, pdfBlob) {
    if (this.client) {
      const fileName = `${budgetId}.pdf`;
      
      const { data, error } = await this.client.storage
        .from('budgets')
        .upload(fileName, pdfBlob, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (error) throw error;

      // Generar URL pública
      const { data: { publicUrl } } = this.client.storage
        .from('budgets')
        .getPublicUrl(fileName);

      return publicUrl;
    } else {
      // Simulación de subida: Generamos un ObjectURL local para simular la vista previa de descarga
      // Para que persista en esta sesión simulada, lo convertimos a DataURL base64 y lo guardamos
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result;
          // Guardamos temporalmente en localStorage (nota: los archivos pesados pueden superar los 5MB,
          // pero un PDF de factura simple es liviano. Si falla por espacio, usamos un mock estático).
          try {
            localStorage.setItem(`pdf_${budgetId}`, dataUrl);
          } catch (e) {
            console.warn("[SupabaseStorage Mock] Archivo muy grande para LocalStorage. Usando fallback local.");
          }
          // Devolvemos una URL que el navegador entienda en esta sesión (ObjectURL)
          const blobUrl = URL.createObjectURL(pdfBlob);
          resolve(blobUrl);
        };
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });
    }
  }

  // --- ANALYTICS / VIEW METRICS ---

  async logView(budgetId) {
    if (this.client) {
      const { error } = await this.client
        .from('budget_views')
        .insert({ budget_id: budgetId });
      if (error) console.error("Error logging view:", error);
    } else {
      const views = JSON.parse(localStorage.getItem('tb_budget_views'));
      views.push({
        budget_id: budgetId,
        viewed_at: new Date().toISOString()
      });
      localStorage.setItem('tb_budget_views', JSON.stringify(views));

      // Actualizamos estado a "viewed"
      const budgets = JSON.parse(localStorage.getItem('tb_budgets'));
      if (budgets[budgetId] && budgets[budgetId].status === 'sent') {
        budgets[budgetId].status = 'viewed';
        localStorage.setItem('tb_budgets', JSON.stringify(budgets));
      }
    }
  }
}

export const supabaseService = new SupabaseService();
export const isRealSupabase = isRealSupabaseConfigured;
export { supabaseUrl };
