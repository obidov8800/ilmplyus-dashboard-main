import { formatPhone, normalizePhone } from '../../utils/phone';
import { omitEmpty } from '../../utils/payload';
import { DEFAULT_BRANCH_TYPE, normalizeBranchType, type BranchType } from '../../utils/branchType';

export interface Branch {
  id: number;
  // Backend filial nomi va manzilini tilga bog'langan ustunlarda qaytaradi
  // (`name_uz`, `address_uz`), oddiy `name` / `address` emas.
  name_uz?: string;
  name_ru?: string;
  name_en?: string;
  name?: string;
  branch_code?: string;
  /** Filial turi: oddiy yoki maktabga tayyorlov. Eski javobda bo'lmasa — `standard`. */
  type?: BranchType;
  city: string;
  has_contract: number;
  director_name: string;
  address_uz?: string;
  address_ru?: string;
  address_en?: string;
  address?: string;
  legal_address_uz?: string;
  legal_address_ru?: string;
  legal_address_en?: string;
  postal_code: string;
  legal_name: string;
  inn: string;
  phone: string;
  bank_name: string;
  account_number: string;
  mfo: string;
  oked: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export const emptyBranchForm = {
  filial_nomi: '',
  filial_nomi_ru: '',
  filial_nomi_en: '',
  branch_code: '',
  type: DEFAULT_BRANCH_TYPE as BranchType,
  yuridik_nomi: '',
  tashkilot_inn: '',
  yuridik_manzil_uz: '',
  yuridik_manzil_ru: '',
  yuridik_manzil_en: '',
  pochta_indeksi: '',
  direktor_fio: '',
  bank_nomi: '',
  ishchi_raqami: '',
  mfo: '',
  oked: '',
  manzil: '',
  manzil_ru: '',
  manzil_en: '',
  shahar: '',
  telefon_nomer: '+998',
  holat: true,
  arxivga_olinsin: false,
};

export type BranchForm = typeof emptyBranchForm;

/**
 * Backend `UpdateBranchRequest`da bu maydonlar `sometimes|string` (nullable EMAS): tahrirlashda bo'sh
 * yuborilsa saqlash 422 bilan rad etiladi (NULL ustunli filial hech qachon saqlanmasdi) — shu sabab
 * tahrirlashda bo'sh bo'lsa umuman yuborilmaydi. `name_ru/en`, `address_ru/en` — `nullable`, ularga tegilmaydi.
 */
const REQUIRED_STRING_ON_UPDATE = [
  'name_uz',
  'branch_code',
  'city',
  'director_name',
  'address_uz',
  'postal_code',
  'legal_name',
  'inn',
  'bank_name',
  'account_number',
  'mfo',
  'oked',
] as const;

const branchPayloadFields = (form: BranchForm) => ({
  name_uz: form.filial_nomi,
  name_ru: form.filial_nomi_ru.trim() || '',
  name_en: form.filial_nomi_en.trim() || '',
  branch_code: form.branch_code,
  type: form.type,
  legal_name: form.yuridik_nomi,
  inn: form.tashkilot_inn,
  legal_address_uz: form.yuridik_manzil_uz,
  legal_address_ru: form.yuridik_manzil_ru,
  legal_address_en: form.yuridik_manzil_en,
  postal_code: form.pochta_indeksi,
  director_name: form.direktor_fio,
  bank_name: form.bank_nomi,
  account_number: form.ishchi_raqami,
  mfo: form.mfo,
  oked: form.oked,
  address_uz: form.manzil,
  address_ru: form.manzil_ru.trim() || '',
  address_en: form.manzil_en.trim() || '',
  city: form.shahar,
  phone: normalizePhone(form.telefon_nomer),
  is_active: form.holat ? 1 : 0,
});

/**
 * `originalType` — tahrirlanayotgan filialning joriy turi. Tur o'zgarmagan bo'lsa yuborilmaydi: backend
 * guruh yoki o'quvchisi bor filialda turni o'zgartirishni 422 bilan rad etadi, shu sabab boshqa maydonlarni
 * saqlash turga umuman bog'liq bo'lmasligi kerak. Yangi filialda `type` har doim yuboriladi.
 */
export const buildBranchPayload = (form: BranchForm, isEditing = false, originalType?: unknown) => {
  const payload = branchPayloadFields(form);
  if (!isEditing) return payload;
  const { type, ...rest } = omitEmpty(payload, REQUIRED_STRING_ON_UPDATE);
  return normalizeBranchType(originalType) === form.type ? rest : { ...rest, type };
};

export const branchToForm = (branch: Branch): BranchForm => ({
  filial_nomi: branch.name_uz || branch.name || '',
  filial_nomi_ru: branch.name_ru || '',
  filial_nomi_en: branch.name_en || '',
  branch_code: branch.branch_code || '',
  type: normalizeBranchType(branch.type),
  yuridik_nomi: branch.legal_name || '',
  tashkilot_inn: branch.inn || '',
  yuridik_manzil_uz: branch.legal_address_uz || '',
  yuridik_manzil_ru: branch.legal_address_ru || '',
  yuridik_manzil_en: branch.legal_address_en || '',
  pochta_indeksi: branch.postal_code || '',
  direktor_fio: branch.director_name || '',
  bank_nomi: branch.bank_name || '',
  ishchi_raqami: branch.account_number || '',
  mfo: branch.mfo || '',
  oked: branch.oked || '',
  manzil: branch.address_uz || branch.address || '',
  manzil_ru: branch.address_ru || '',
  manzil_en: branch.address_en || '',
  shahar: branch.city || '',
  telefon_nomer: formatPhone(branch.phone),
  holat: branch.is_active === 1,
  arxivga_olinsin: false,
});
