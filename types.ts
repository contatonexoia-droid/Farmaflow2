export interface DepartmentConfig {
  id: string;
  name: string;
  categories: string[];
  icon?: string;
  order_index?: number;
}

export interface AiAgentConfig {
  enabled: boolean;
  provider: 'gemini' | 'openai' | 'claude' | 'groq' | 'evolution';
  model: string;
  apiKey?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxInteractions?: number;
  customStoreUrl?: string;
  searchMaxResults?: number;
  enableStockCheck?: boolean;
  enablePriceCheck?: boolean;
  enablePrescriptionGuidance?: boolean;
  enableHumanHandoff?: boolean;
  handoffKeywords?: string[];
  autoTagPrescriptions?: boolean;
  autoTransferOnPrescription?: boolean;
}

export interface PharmacyConfig {
  id: string;
  name: string;
  tenant_id: string;
  store_id: string;
  phone?: string;
  whatsapp_number?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  logo_url?: string;
  primary_color?: string;
  ai_agent_config?: AiAgentConfig;
  departments?: DepartmentConfig[];
  custom_domain?: string;
}

export interface PrescriptionRejectionReasonItem {
  id: string;
  store_id: string;
  title: string;
  description?: string;
  message_template: string;
  is_active: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface MedicalPrescription {
  id: string;
  store_id: string;
  conversation_id?: string;
  order_id?: string;
  file_url: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejection_reason_id?: string;
  rejection_reason_title?: string;
  rejection_notes?: string;
  evaluated_by?: string;
  evaluated_by_name?: string;
  evaluated_at?: string;
  created_at?: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  internal_code?: string;
  barcode?: string;
  name: string;
  active_principle?: string;
  drug_type?: string;
  manufacturer?: string;
  presentation?: string;
  price: number;
  original_price?: number;
  stock: number;
  category?: string;
  grouping_slug?: string;
  variant_attribute?: string;
  image?: string;
  is_featured?: boolean;
  requires_prescription?: boolean;
  promotion_type?: string;
  buy_x?: number;
  pay_y?: number;
  discount_qty_threshold?: number;
  discount_qty_percentage?: number;
  video_uri?: string;
  description?: string;
  indications?: string;
  usage?: string;
  side_effects?: string;
  contraindications?: string;
  is_ai_enriched?: boolean;
}

export interface OrderItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  requires_prescription?: boolean;
}

export interface Order {
  id: string;
  tenant_id: string;
  customer_name: string;
  customer_phone: string;
  customer_address?: string;
  items: OrderItem[];
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  payment_method?: string;
  prescription_url?: string;
  prescription_status?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  created_at: string;
  updated_at?: string;
}
