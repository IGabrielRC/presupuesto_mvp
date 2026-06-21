/**
 * Representa un ítem individual dentro de un presupuesto.
 */
export class BudgetItem {
  constructor(description = '', quantity = 1, unitPrice = 0) {
    this.description = description;
    this.quantity = Number(quantity) || 0;
    this.unitPrice = Number(unitPrice) || 0;
  }

  get total() {
    return this.quantity * this.unitPrice;
  }
}

/**
 * Representa la entidad de dominio de un Presupuesto.
 * Contiene las reglas puras del negocio y cálculos de costos.
 */
export class Budget {
  constructor({
    id = null,
    clientName = '',
    clientPhone = '',
    clientEmail = '',
    items = [],
    taxRate = 0.21, // 21% IVA por defecto (configurable)
    createdAt = new Date(),
    status = 'draft',
    pdfUrl = null
  } = {}) {
    this.id = id;
    this.clientName = clientName;
    this.clientPhone = clientPhone;
    this.clientEmail = clientEmail;
    this.items = items.map(item => new BudgetItem(item.description, item.quantity, item.unitPrice));
    this.taxRate = Number(taxRate) || 0;
    this.createdAt = createdAt instanceof Date ? createdAt : new Date(createdAt);
    this.status = status;
    this.pdfUrl = pdfUrl;
  }

  addItem(description, quantity, unitPrice) {
    this.items.push(new BudgetItem(description, quantity, unitPrice));
  }

  removeItem(index) {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
    }
  }

  updateItem(index, fields = {}) {
    if (index >= 0 && index < this.items.length) {
      const item = this.items[index];
      if (fields.description !== undefined) item.description = fields.description;
      if (fields.quantity !== undefined) item.quantity = Number(fields.quantity) || 0;
      if (fields.unitPrice !== undefined) item.unitPrice = Number(fields.unitPrice) || 0;
    }
  }

  get subtotal() {
    return this.items.reduce((sum, item) => sum + item.total, 0);
  }

  get taxAmount() {
    return this.subtotal * this.taxRate;
  }

  get total() {
    return this.subtotal + this.taxAmount;
  }

  /**
   * Helper para formatear montos en formato de moneda local.
   */
  static formatCurrency(amount, currencySymbol = '$') {
    return `${currencySymbol} ${Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  /**
   * Serializa la entidad a un objeto simple para guardarlo en Supabase.
   */
  toRow(userId) {
    return {
      user_id: userId,
      client_name: this.clientName,
      client_phone: this.clientPhone,
      client_email: this.clientEmail,
      status: this.status,
      pdf_url: this.pdfUrl
    };
  }

  /**
   * Genera el detalle de los ítems en formato de fila para Supabase.
   */
  itemsToRows(budgetId) {
    return this.items.map(item => ({
      budget_id: budgetId,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice
    }));
  }
}
