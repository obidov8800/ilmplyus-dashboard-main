import { Link } from 'react-router-dom';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import MultiPicker from '@/components/MultiPicker';
import { API } from '../../api/api';
import './finance.css';
import PageTitle from '@/components/PageTitle';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import StatusBadge from '@/components/StatusBadge';
import { statusTone } from '@/utils/statusTone';
import { notifySuccess, notifyWarning } from '@/utils/notify';
import { useOptions } from '../../hooks/useOptions';
import { usePermission } from '@/hooks/usePermission';

// ─── Types ────────────────────────────────────────────────────────────────────

type Purpose = 'operating' | 'payroll' | 'payroll_tax';

interface NameFundRef {
  id: number;
  branch_id: number;
  status: string;
  is_active: boolean;
  total_balance: number;
}

interface JamgarmaNameRow {
  id: number;
  name?: string;
  name_uz: string;
  name_ru?: string | null;
  name_en?: string | null;
  jamgarma_fund_type: string;
  purpose: Purpose;
  is_active: boolean;
  branch_ids?: number[];
  branches?: { id: number; name?: string; name_uz?: string }[];
  jamgarmas_count?: number;
  jamgarmas?: NameFundRef[];
  created_at?: string;
}

interface GeneratedItem {
  branch_id: number;
  branch_name?: string;
  jamgarma_id: number;
  reason?: string;
}

interface Generated {
  created: GeneratedItem[];
  linked: GeneratedItem[];
  skipped: GeneratedItem[];
}

const SECTION_OPTIONS = [
  { value: 'harmless_point', label: 'Zararsiz ishlar nuqtasi' },
  { value: 'marginal_income', label: 'Marjinal daromad' },
  { value: 'adjusted_income', label: 'Muvofiqlashtirillgan daromad (MD)' },
];

const emptyForm = {
  name_uz: '',
  name_ru: '',
  name_en: '',
  jamgarma_fund_type: '',
  purpose: 'operating' as Purpose,
  is_active: true,
};

// ─── Main Component ───────────────────────────────────────────────────────────

const JamgarmaNamesPage = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  // `auto_create` va «Avtomatik yaratish» tugmasi qo'shimcha `jamgarmas.create` ruxsatini talab qiladi.
  const canGenerate = usePermission('jamgarmas.create');

  // ── UI state ─────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<JamgarmaNameRow | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [result, setResult] = useState<{ name: string; generated: Generated } | null>(null);
  const [search, setSearch] = useState('');
  const [purposeFilter, setPurposeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // ── Form state ───────────────────────────────────────────────────
  const [form, setForm] = useState(emptyForm);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [autoCreate, setAutoCreate] = useState(true);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: names = [], isLoading } = useQuery<JamgarmaNameRow[]>({
    queryKey: ['jamgarma-names'],
    queryFn: async () => {
      const { data } = await API.get('/jamgarma-names');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    placeholderData: keepPreviousData,
  });

  const { data: branches = [] } = useOptions('branches');

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const branchLabel = (id: number) => branches.find((b) => b.id === id)?.label ?? `#${id}`;
  const getName = (item: JamgarmaNameRow) =>
    getLocalized(item, 'name', i18n.language) || item.name_uz || '-';
  const getSectionLabel = (value?: string) =>
    SECTION_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '-';
  const getPurposeLabel = (purpose: string) => t(`jamgarma.purpose.${purpose}`, purpose);

  const formatAmount = (val: number) =>
    Number(val)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const reasonLabel = (reason?: string) =>
    reason === 'purpose_taken'
      ? t('jamgarmaNames.reason.purpose_taken')
      : reason === 'deleted'
        ? t('jamgarmaNames.reason.deleted')
        : t('jamgarmaNames.reason.exists');

  const summaryMessage = (g: Generated) => {
    const parts = (['created', 'linked', 'skipped'] as const)
      .filter((kind) => g[kind].length > 0)
      .map((kind) => t(`jamgarmaNames.summaryParts.${kind}`, { n: g[kind].length }));
    return parts.length ? parts.join(', ') : t('jamgarmaNames.summaryEmpty');
  };

  /** Avtomatik yaratish natijasi: qisqa xabar + (o'tkazib yuborilganlar bo'lsa) batafsil oyna. */
  const showGenerated = (item: { name_uz: string }, generated?: Generated) => {
    if (!generated) return;
    notifySuccess(summaryMessage(generated));
    if (generated.skipped.some((s) => s.reason !== 'exists') || generated.created.length + generated.linked.length > 0) {
      setResult({ name: item.name_uz, generated });
    }
  };

  // ─── Mutations ────────────────────────────────────────────────────────────

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['jamgarma-names'] });
    queryClient.invalidateQueries({ queryKey: ['jamgarmas'] });
  };

  // Ikki marta bosish: backend bittasini 201, ikkinchisini 422 (`name_uz` takror) qaytaradi — foydalanuvchi xato ko'rmasligi uchun
  // so'rov tugamaguncha ikkinchisi umuman yuborilmaydi (`isPending` keyingi renderdan keyin yangilanadi, ref esa darhol).
  const inflight = useRef(false);

  const saveMutation = useMutation({
    mutationFn: async ({ id, payload }: { id?: number; payload: object }) => {
      const { data } = id
        ? await API.put(`/jamgarma-names/${id}`, payload)
        : await API.post('/jamgarma-names', payload);
      return data as { data: JamgarmaNameRow; generated?: Generated };
    },
    onSuccess: (res) => {
      refresh();
      closeModal();
      showGenerated(res.data, res.generated);
    },
    onSettled: () => {
      inflight.current = false;
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data } = await API.post(`/jamgarma-names/${id}/generate`, {});
      return data as { data: JamgarmaNameRow; generated?: Generated };
    },
    onSuccess: (res) => {
      refresh();
      showGenerated(res.data, res.generated);
    },
    onSettled: () => {
      inflight.current = false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/jamgarma-names/${id}`);
    },
    onSuccess: () => {
      refresh();
      setDeleteId(null);
    },
  });

  // ─── Modal helpers ─────────────────────────────────────────────────────────

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setForm(emptyForm);
    setBranchIds([]);
    setAutoCreate(true);
  };

  const openCreate = () => {
    setEditingItem(null);
    setForm(emptyForm);
    setBranchIds([]);
    setAutoCreate(true);
    setShowModal(true);
  };

  const openEdit = (item: JamgarmaNameRow) => {
    setEditingItem(item);
    setForm({
      name_uz: item.name_uz || '',
      name_ru: item.name_ru || '',
      name_en: item.name_en || '',
      jamgarma_fund_type: item.jamgarma_fund_type || '',
      purpose: item.purpose || 'operating',
      is_active: item.is_active,
    });
    setBranchIds(item.branch_ids ?? item.branches?.map((b) => b.id) ?? []);
    setAutoCreate(false);
    setShowModal(true);
  };

  const formInvalid = !form.name_uz.trim() || !form.jamgarma_fund_type || branchIds.length === 0;

  const handleSubmit = () => {
    if (inflight.current) return;
    if (formInvalid) {
      notifyWarning(t('jamgarmaNames.required'));
      return;
    }
    const payload = {
      name_uz: form.name_uz.trim(),
      // RU/EN faqat tahrirlashda ko'rinadi; bo'sh qoldirilsa backend avtomatik tarjima qiladi.
      ...(editingItem && {
        name_ru: form.name_ru.trim() || null,
        name_en: form.name_en.trim() || null,
      }),
      jamgarma_fund_type: form.jamgarma_fund_type,
      purpose: form.purpose,
      is_active: form.is_active,
      branch_ids: branchIds,
      auto_create: canGenerate && autoCreate && form.is_active,
    };
    inflight.current = true;
    saveMutation.mutate({ id: editingItem?.id, payload });
  };

  // ─── Filtered & paginated data ─────────────────────────────────────────────

  const filtered = (() => {
    let rows = [...names];
    if (purposeFilter) rows = rows.filter((n) => n.purpose === purposeFilter);
    if (statusFilter) rows = rows.filter((n) => (statusFilter === 'active') === n.is_active);
    if (branchFilter) {
      rows = rows.filter((n) => (n.branch_ids ?? []).includes(Number(branchFilter)));
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (n) =>
          (n.name_uz || '').toLowerCase().includes(q) ||
          (n.name_ru || '').toLowerCase().includes(q) ||
          (n.name_en || '').toLowerCase().includes(q),
      );
    }
    return rows;
  })();

  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const purposeLocked = !!editingItem && (editingItem.jamgarmas_count ?? 0) > 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <section className="finances container">
      <PageTitle title={t('aside.jamgarmaNames')} icon="fa-tags" />

      {/* ── Create / Edit Modal ──────────────────────────────────────────── */}
      {showModal && (
        <div className="fin-modal-overlay" onClick={closeModal}>
          <div className="fin-modal fin-modal-jamgarma" onClick={(e) => e.stopPropagation()}>
            <h3 className="fin-modal-title">
              {editingItem ? t('jamgarmaNames.edit') : t('jamgarmaNames.create')}
            </h3>

            <div className="fin-form-group">
              <label>
                {t('jamgarmaNames.name')} (UZ)
                {!editingItem && <InfoHint text={t('jamgarmaNames.autoTranslate')} />}
              </label>
              <input
                type="text"
                value={form.name_uz}
                onChange={(e) => setForm({ ...form, name_uz: e.target.value })}
                placeholder={t('jamgarma.namePlaceholder')}
              />
            </div>

            {editingItem && (
              <>
                <div className="fin-form-group">
                  <label>{t('jamgarmaNames.name')} (RU)</label>
                  <input
                    type="text"
                    value={form.name_ru}
                    onChange={(e) => setForm({ ...form, name_ru: e.target.value })}
                    placeholder={t('jamgarma.namePlaceholder')}
                  />
                </div>
                <div className="fin-form-group">
                  <label>{t('jamgarmaNames.name')} (EN)</label>
                  <input
                    type="text"
                    value={form.name_en}
                    onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                    placeholder={t('jamgarma.namePlaceholder')}
                  />
                </div>
              </>
            )}
            <div className="fin-form-group">
              <label>{t('jamgarma.section')}</label>
              <select
                value={form.jamgarma_fund_type}
                onChange={(e) => setForm({ ...form, jamgarma_fund_type: e.target.value })}
              >
                <option value="">{t('jamgarma.choose')}</option>
                {SECTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="fin-form-group">
              <label>
                {t('jamgarma.purposeLabel')}
                <InfoHint
                  text={purposeLocked ? t('jamgarmaNames.purposeLocked') : t('jamgarmaNames.purposeNote')}
                />
              </label>
              <select
                value={form.purpose}
                disabled={purposeLocked}
                onChange={(e) => setForm({ ...form, purpose: e.target.value as Purpose })}
              >
                <option value="operating">{t('jamgarma.purpose.operating')}</option>
                <option value="payroll">{t('jamgarma.purpose.payroll')}</option>
                <option value="payroll_tax">{t('jamgarma.purpose.payroll_tax')}</option>
              </select>
            </div>

            <div className="fin-form-group">
              <label>{t('jamgarmaNames.branches')}</label>

              <MultiPicker
                options={branches.map((b) => ({ value: b.id, label: b.label }))}
                value={branchIds}
                onChange={setBranchIds}
                placeholder={t('jamgarma.choose')}
              />
            </div>

            {editingItem && (
              <div className="fin-form-group">
                <label>{t('jamgarma.statusLabel')}</label>
                <select
                  value={form.is_active ? 'active' : 'inactive'}
                  onChange={(e) => setForm({ ...form, is_active: e.target.value === 'active' })}
                >
                  <option value="active">{t('jamgarma.statusActive')}</option>
                  <option value="inactive">{t('jamgarma.statusInactive')}</option>
                </select>
              </div>
            )}

            {canGenerate && (
              <label className="fin-check-row">
                <input
                  type="checkbox"
                  checked={autoCreate && form.is_active}
                  disabled={!form.is_active}
                  onChange={(e) => setAutoCreate(e.target.checked)}
                />
                <span>
                  <b>{t('jamgarmaNames.autoCreate')}</b>
                  <InfoHint text={t('jamgarmaNames.autoCreateNote')} />
                </span>
              </label>
            )}

            {editingItem && (editingItem.jamgarmas?.length ?? 0) > 0 && (
              <div className="fin-balance-row">
                <span className="fin-balance-title">{t('jamgarmaNames.openedFunds')}</span>
                {editingItem.jamgarmas!.map((f) => (
                  <div key={f.id} className="fin-balance-item">
                    <span className="fin-balance-label">{branchLabel(f.branch_id)}</span>
                    <span className="fin-balance-value fin-text-green">
                      {formatAmount(f.total_balance)} UZS
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="fin-modal-actions">
              <button
                className="fin-btn-save"
                onClick={handleSubmit}
                disabled={formInvalid || saveMutation.isPending}
              >
                {saveMutation.isPending ? t('jamgarma.saving') : t('jamgarma.save')}
              </button>
              <button className="fin-btn-cancel" onClick={closeModal} type="button">
                {t('jamgarma.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Auto-create result ────────────────────────────────────────────── */}
      {result && (
        <div className="fin-modal-overlay" onClick={() => setResult(null)}>
          <div className="fin-modal fin-modal-jamgarma" onClick={(e) => e.stopPropagation()}>
            <h3 className="fin-modal-title">{t('jamgarmaNames.resultTitle')}</h3>
            <p className="fin-confirm-text">
              <b>{result.name}</b> — {summaryMessage(result.generated)}
            </p>
            {(
              [
                ['created', result.generated.created],
                ['linked', result.generated.linked],
                ['skipped', result.generated.skipped],
              ] as const
            ).map(([kind, list]) =>
              list.length > 0 ? (
                <div key={kind} className="fin-balance-row">
                  <span className="fin-balance-title">{t(`jamgarmaNames.result.${kind}`)}</span>
                  {list.map((it) => (
                    <div key={`${kind}-${it.branch_id}`} className="fin-balance-item">
                      <span className="fin-balance-label">
                        {it.branch_name || branchLabel(it.branch_id)}
                      </span>
                      {kind === 'skipped' && (
                        <span className="fin-balance-none">{reasonLabel(it.reason)}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null,
            )}
            {result.generated.created.length > 0 && (
              <div>
                <InfoHint withLabel text={t('jamgarmaNames.withdrawersReminder')} />
              </div>
            )}
            <div className="fin-modal-actions">
              <button className="fin-btn-cancel" onClick={() => setResult(null)}>
                {t('jamgarma.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────────────────────── */}
      {deleteId !== null && (
        <div className="fin-modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="fin-modal fin-modal-sm" onClick={(e) => e.stopPropagation()}>
            <p className="fin-confirm-text">{t('jamgarmaNames.confirmDelete')}</p>
            <div className="fin-modal-actions">
              <button
                className="fin-btn-danger"
                onClick={() => deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
              >
                {t('jamgarma.confirm')}
              </button>
              <button className="fin-btn-cancel" onClick={() => setDeleteId(null)}>
                {t('jamgarma.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="fin-toolbar">
        <div className="fin-search-box">
          <input
            placeholder={t('jamgarma.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <i className="fa-solid fa-magnifying-glass" />
        </div>
        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('finance.branch', 'Filial')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          value={purposeFilter}
          onChange={(e) => {
            setPurposeFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('jamgarma.purposeFilterAll')}</option>
          <option value="operating">{t('jamgarma.purpose.operating')}</option>
          <option value="payroll">{t('jamgarma.purpose.payroll')}</option>
          <option value="payroll_tax">{t('jamgarma.purpose.payroll_tax')}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('jamgarmaNames.statusAll')}</option>
          <option value="active">{t('jamgarma.statusActive')}</option>
          <option value="inactive">{t('jamgarma.statusInactive')}</option>
        </select>
        <Protected permission="jamgarma_names.create">
          <button className="fin-btn-add" onClick={openCreate}>
            {t('jamgarma.add')}
          </button>
        </Protected>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="fin-table-wrapper">
        <table className="fin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>{t('jamgarmaNames.nameCol')}</th>
              <th>{t('jamgarma.sectionCol')}</th>
              <th>{t('jamgarma.purposeCol')}</th>
              <th>{t('jamgarmaNames.branchesCol')}</th>
              <th>{t('jamgarmaNames.fundsCol')}</th>
              <th>{t('jamgarma.statusCol')}</th>
              <th>{t('jamgarma.actionsCol')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={10} columnCount={8} />
            ) : paginated.length > 0 ? (
              paginated.map((item) => {
                const ids = item.branch_ids ?? item.branches?.map((b) => b.id) ?? [];
                const shown = ids.slice(0, 3);
                return (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{getName(item)}</td>
                    <td>{getSectionLabel(item.jamgarma_fund_type)}</td>
                    <td>
                      <span className={`fin-purpose-badge fin-purpose-badge--${item.purpose}`}>
                        {getPurposeLabel(item.purpose)}
                      </span>
                    </td>
                    <td className="fin-signatories-cell">
                      {ids.length > 0 ? (
                        <div className="fin-chip-list fin-chip-list--table">
                          {shown.map((id) => (
                            <span key={id} className="fin-chip fin-chip--sm">
                              {branchLabel(id)}
                            </span>
                          ))}
                          {ids.length > shown.length && (
                            <span className="fin-chip fin-chip--sm fin-chip--more">
                              +{ids.length - shown.length}
                            </span>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td><Link to={`/jamgarma?jamgarma_name_id=${item.id}`} aria-label={t('jamgarmaNames.viewFunds', { name: item.name_uz })}>{item.jamgarmas_count ?? 0}</Link></td>
                    <td>
                      <StatusBadge tone={statusTone(item.is_active ? 'active' : 'inactive')}>
                        {item.is_active ? t('jamgarma.statusActive') : t('jamgarma.statusInactive')}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="fin-actions">
                        {canGenerate && item.is_active && (
                          <button
                            className="fin-action-btn fin-action-generate"
                            onClick={() => {
                              if (inflight.current) return;
                              inflight.current = true;
                              generateMutation.mutate(item.id);
                            }}
                            disabled={generateMutation.isPending}
                            title={t('jamgarmaNames.generate')}
                          >
                            <i className="fa-solid fa-wand-magic-sparkles" />
                          </button>
                        )}
                        <Protected permission="jamgarma_names.edit">
                          <button
                            className="fin-action-btn fin-action-edit"
                            onClick={() => openEdit(item)}
                            title={t('jamgarma.editBtn')}
                          >
                            <i className="fa-solid fa-pen" />
                          </button>
                        </Protected>
                        <Protected permission="jamgarma_names.delete">
                          <button
                            className="fin-action-btn fin-action-delete"
                            onClick={() => setDeleteId(item.id)}
                            title={t('jamgarma.deleteBtn')}
                          >
                            <i className="fa-solid fa-trash" />
                          </button>
                        </Protected>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <EmptyState colSpan={8} message={t('jamgarmaNames.noData')} />
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <PaginationBar
          page={safePage}
          totalPages={lastPage}
          total={filtered.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </section>
  );
};

export default JamgarmaNamesPage;
