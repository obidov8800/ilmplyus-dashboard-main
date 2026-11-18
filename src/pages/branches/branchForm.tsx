import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import { useTranslation } from 'react-i18next';
import './branches.css';
import type { Branch } from './branch.types';
import { emptyBranchForm, buildBranchPayload, branchToForm } from './branch.types';
import { formatPhone, isValidUzPhone } from '../../utils/phone';
import { notifyWarning } from '@/utils/notify';
import { BRANCH_TYPES, branchTypeLabelKey, type BranchType } from '../../utils/branchType';
import { getFieldError } from '../../utils/apiError';

const BranchForm = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const isEditing = Boolean(id);

  const [branchFormData, setBranchFormData] = useState(emptyBranchForm);
  // Backend turni o'zgartirishni rad etsa (filialda guruh yoki o'quvchi bor) — xabar tur maydoni tagida turadi.
  const [typeError, setTypeError] = useState('');

  // `GET /branches/{id}` backendda `branches.show` ruxsatini talab qiladi, u bazada UMUMAN YO'Q (Super admin'da ham) —
  // so'rov har doim 403 berardi va forma bo'sh qolardi. `GET /branches` (`branches.view`) xuddi shu yozuvlarni to'liq
  // qaytaradi (ikkalasi ham xom `Branch` modeli), shu sabab yozuv ro'yxatdan olinadi. Ro'yxatda topilmasa (masalan,
  // keyinchalik backend `branches.show`ni qo'shsa) bitta yozuv so'rovi sinab ko'riladi, xato bo'lsa jim.
  const { data: branch } = useQuery<Branch | null>({
    queryKey: ['branch', id],
    enabled: isEditing,
    queryFn: async () => {
      const { data: list } = await API.get('/branches');
      const rows: Branch[] = Array.isArray(list) ? list : (list?.data ?? []);
      const found = rows.find((b) => String(b.id) === String(id));
      if (found) return found;
      try {
        const { data } = await API.get(`/branches/${id}`, { silentError: true });
        return data?.data || data;
      } catch {
        return null;
      }
    },
  });

  useEffect(() => {
    if (branch) setBranchFormData(branchToForm(branch));
  }, [branch]);

  const saveMutation = useMutation({
    mutationFn: async (form: typeof emptyBranchForm) => {
      const payload = buildBranchPayload(form, isEditing, branch?.type);
      if (isEditing) {
        const res = await API.put(`/branches/${id}`, payload);
        // «Nofaol» + «Arxivga olinsinmi? — Ha»: ilgari bu tanlov hech qayerga yuborilmasdi (filial arxivga tushmasdi).
        // Arxiv = o'chirilgan yozuvlar ro'yxati (`/branches/archive`), shu sabab holat saqlangach filial arxivlanadi.
        if (!form.holat && form.arxivga_olinsin) await API.delete(`/branches/${id}`);
        return res;
      }
      return API.post('/branches', payload);
    },
    onError: (error) => {
      setTypeError(getFieldError(error, 'type') ?? '');
    },
    onSuccess: () => {
      // QueryClient'da `refetchOnMount: false` (main.tsx) — shuning uchun oddiy
      // invalidate ro'yxatni faqat "stale" deb belgilaydi va `/branches` qayta
      // ochilganda so'rov umuman yuborilmaydi, eski ma'lumot ko'rinaveradi.
      // `refetchType: 'all'` nofaol so'rovni ham darhol qayta yuklaydi.
      queryClient.invalidateQueries({ queryKey: ['branches'], refetchType: 'all' });
      if (isEditing) {
        queryClient.invalidateQueries({ queryKey: ['branch', id], refetchType: 'all' });
      }
      navigate('/branches');
    },
  });

  const set = (field: keyof typeof emptyBranchForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBranchFormData((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <section className="brf-page">
      <div className="brf-card">
        <h1 className="brf-heading">
          {isEditing ? t('branches.editBranchTitle') : t('branches.addNewBranchTitle')}
        </h1>

        <div className="brf-body">
          <div className="brf-sections">
            <section className="brf-section">
              <h2>{t('branches.sectionGeneral')}</h2>
              <div className="brf-fields">
                <div className="branch-input-group">
                  <label>{t('branches.branchName')} (UZ)</label>
                  <div className="branch-name-row">
                    <input
                      type="text"
                      placeholder={t('branches.branchName')}
                      value={branchFormData.filial_nomi}
                      onChange={set('filial_nomi')}
                    />
                    <input
                      type="text"
                      aria-label={t('branches.branchCode')}
                      maxLength={4}
                      placeholder={t('branches.branchCode')}
                      value={branchFormData.branch_code}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setBranchFormData((prev) => ({ ...prev, branch_code: val }));
                      }}
                      className="branch-code-input"
                    />
                  </div>
                </div>
                {isEditing && (
                  <>
                    <div className="branch-input-group">
                      <label>{t('branches.branchName')} (RU)</label>
                      <input
                        type="text"
                        value={branchFormData.filial_nomi_ru}
                        onChange={set('filial_nomi_ru')}
                      />
                    </div>
                    <div className="branch-input-group">
                      <label>{t('branches.branchName')} (EN)</label>
                      <input
                        type="text"
                        value={branchFormData.filial_nomi_en}
                        onChange={set('filial_nomi_en')}
                      />
                    </div>
                  </>
                )}
                <div className="branch-input-group">
                  <label>{t('branches.address')} (UZ)</label>
                  <input type="text" value={branchFormData.manzil} onChange={set('manzil')} />
                </div>
                {isEditing && (
                  <>
                    <div className="branch-input-group">
                      <label>{t('branches.address')} (RU)</label>
                      <input
                        type="text"
                        value={branchFormData.manzil_ru}
                        onChange={set('manzil_ru')}
                      />
                    </div>
                    <div className="branch-input-group">
                      <label>{t('branches.address')} (EN)</label>
                      <input
                        type="text"
                        value={branchFormData.manzil_en}
                        onChange={set('manzil_en')}
                      />
                    </div>
                  </>
                )}
                <div className="branch-input-group">
                  <label>{t('branches.city')}</label>
                  <input type="text" value={branchFormData.shahar} onChange={set('shahar')} />
                </div>
                <div className="branch-input-group">
                  <label>{t('branches.phoneNumber')}</label>
                  <input
                    type="tel"
                    placeholder="+998901234567"
                    value={branchFormData.telefon_nomer}
                    onChange={(e) =>
                      setBranchFormData((prev) => ({
                        ...prev,
                        telefon_nomer: formatPhone(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="branch-input-group">
                  <label>{t('branches.type')}</label>
                  <div className="branch-toggle-wrapper" role="radiogroup" aria-label={t('branches.type')}>
                    {BRANCH_TYPES.map((type: BranchType) => (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={branchFormData.type === type}
                        className={branchFormData.type === type ? 'branch-active-btn' : ''}
                        onClick={() => {
                          setTypeError('');
                          setBranchFormData((prev) => ({ ...prev, type }));
                        }}
                      >
                        {t(branchTypeLabelKey(type))}
                      </button>
                    ))}
                  </div>
                  {typeError && (
                    <span className="branch-field-error" role="alert">
                      {typeError}
                    </span>
                  )}
                </div>
                <div className="branch-input-group">
                  <label>{t('branches.status')}</label>
                  <div className="branch-toggle-wrapper">
                    <button
                      type="button"
                      className={branchFormData.holat ? '' : 'branch-active-btn'}
                      onClick={() =>
                        setBranchFormData((prev) => ({
                          ...prev,
                          holat: false,
                          arxivga_olinsin: false,
                        }))
                      }
                    >
                      {t('branches.inactive')}
                    </button>
                    <button
                      type="button"
                      className={branchFormData.holat ? 'branch-active-btn' : ''}
                      onClick={() =>
                        setBranchFormData((prev) => ({
                          ...prev,
                          holat: true,
                          arxivga_olinsin: false,
                        }))
                      }
                    >
                      {t('branches.active')}
                    </button>
                  </div>
                </div>
              {!branchFormData.holat && (
                <div className="branch-input-group">
                    <label className="branch-archive-label">{t('branches.archiveQuestion')}</label>
                    <div className="branch-archive-options">
                      <label className="branch-archive-option">
                        <input
                          type="radio"
                          name="arxivga_olinsin"
                          checked={branchFormData.arxivga_olinsin === true}
                          onChange={() =>
                            setBranchFormData((prev) => ({ ...prev, arxivga_olinsin: true }))
                          }
                        />
                        {t('branches.yes')}
                      </label>
                      <label className="branch-archive-option">
                        <input
                          type="radio"
                          name="arxivga_olinsin"
                          checked={branchFormData.arxivga_olinsin === false}
                          onChange={() =>
                            setBranchFormData((prev) => ({ ...prev, arxivga_olinsin: false }))
                          }
                        />
                        {t('branches.no')}
                      </label>
                    </div>
                  </div>
                )}
                </div>
            </section>
            <section className="brf-section">
              <h2>{t('branches.sectionLegal')}</h2>
              <div className="brf-fields">
                <div className="branch-input-group">
                  <label>{t('branches.legalName')}</label>
                  <input
                    type="text"
                    value={branchFormData.yuridik_nomi}
                    onChange={set('yuridik_nomi')}
                  />
                </div>
                <div className="branch-input-group">
                  <label>{t('branches.organizationInn')}</label>
                  <input
                    type="text"
                    value={branchFormData.tashkilot_inn}
                    onChange={set('tashkilot_inn')}
                  />
                </div>
                <div className="branch-input-group">
                  <label>{t('branches.director')}</label>
                  <input
                    type="text"
                    value={branchFormData.direktor_fio}
                    onChange={set('direktor_fio')}
                  />
                </div>
                <div className="branch-input-group">
                  <label>{t('branches.legalAddress')} (UZ)</label>
                  <input
                    type="text"
                    value={branchFormData.yuridik_manzil_uz}
                    onChange={set('yuridik_manzil_uz')}
                  />
                </div>
                {isEditing && (
                  <>
                    <div className="branch-input-group">
                      <label>{t('branches.legalAddress')} (RU)</label>
                      <input
                        type="text"
                        value={branchFormData.yuridik_manzil_ru}
                        onChange={set('yuridik_manzil_ru')}
                      />
                    </div>
                    <div className="branch-input-group">
                      <label>{t('branches.legalAddress')} (EN)</label>
                      <input
                        type="text"
                        value={branchFormData.yuridik_manzil_en}
                        onChange={set('yuridik_manzil_en')}
                      />
                    </div>
                  </>
                )}
                <div className="branch-input-group">
                  <label>{t('branches.index')}</label>
                  <input
                    type="text"
                    value={branchFormData.pochta_indeksi}
                    onChange={set('pochta_indeksi')}
                  />
                </div>
              </div>
            </section>
            <section className="brf-section">
              <h2>{t('branches.sectionBank')}</h2>
              <div className="brf-fields">
                <div className="branch-input-group">
                  <label>{t('branches.bankName')}</label>
                  <input type="text" value={branchFormData.bank_nomi} onChange={set('bank_nomi')} />
                </div>
                <div className="branch-input-group">
                  <label>{t('branches.accountNumber')}</label>
                  <input
                    type="text"
                    value={branchFormData.ishchi_raqami}
                    onChange={set('ishchi_raqami')}
                  />
                </div>
                <div className="branch-input-group">
                  <label>MFO</label>
                  <input type="text" value={branchFormData.mfo} onChange={set('mfo')} />
                </div>
                <div className="branch-input-group">
                  <label>OKED</label>
                  <input type="text" value={branchFormData.oked} onChange={set('oked')} />
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="brf-footer">
          <button
            className="branch-save-btn"
            onClick={() => {
              if (!isValidUzPhone(branchFormData.telefon_nomer)) {
                notifyWarning(t('common.phoneFormatError'));
                return;
              }
              saveMutation.mutate(branchFormData);
            }}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? t('branches.saving') : t('branches.save')}
          </button>
          <button className="branch-cancel-btn" onClick={() => navigate('/branches')}>
            {t('branches.cancel')}
          </button>
        </div>
      </div>
    </section>
  );
};

export default BranchForm;
