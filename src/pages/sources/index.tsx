import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sourceAPI, type Source, type SourcePayload } from '../../api/source.api';
import '../users/users.css';
import '../expenses/expenses.css';
import './sources.css';
import { useTranslation } from 'react-i18next';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { useTableColumns } from '../../hooks/useTableColumns';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { downloadQrPng } from '../../utils/qrCode';
import { notifications } from '@mantine/notifications';
import { copyToClipboard } from '../../utils/clipboard';
import { notifyError } from '@/utils/notify';

interface SourceFormData {
  name_uz: string;
  name_ru: string;
  name_en: string;
  created_at: string;
  updated_at: string;
}

const emptyForm: SourceFormData = {
  name_uz: '',
  name_ru: '',
  name_en: '',
  created_at: '',
  updated_at: '',
};

const formatDateTime = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toLocalDateTimeInput = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const Sources = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('sources');
  // checkbox + (id) + drag qilinadigan ustunlar + actions
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: Source, colId: string) => {
    switch (colId) {
      case 'name':
        return getLocalized(item, 'name', i18n.language);
      case 'link':
        if (!item.link) return '-';
        return (
          <span className="sources-link-cell">
            <a href={item.link} target="_blank" rel="noopener noreferrer">
              {item.link}
            </a>
            <button
              type="button"
              className="sources-qr-btn"
              title={t('sources.copyLink')}
              aria-label={t('sources.copyLink')}
              onClick={() => handleCopyLink(item.link as string)}
            >
              <i className="fa-solid fa-copy"></i>
            </button>
            <button
              type="button"
              className="sources-qr-btn"
              title={t('sources.downloadQr')}
              aria-label={t('sources.downloadQr')}
              onClick={() => handleDownloadQr(item)}
            >
              <i className="fa-solid fa-qrcode"></i>
            </button>
          </span>
        );
      case 'created_at':
        return formatDateTime(item.created_at);
      case 'updated_at':
        return formatDateTime(item.updated_at);
      default:
        return '-';
    }
  };

  // Manba havolasini bufferga nusxalash + qisqa bildirishnoma.
  const handleCopyLink = async (link: string) => {
    const ok = await copyToClipboard(link);
    notifications.show({
      message: ok ? t('sources.linkCopied') : t('sources.copyError'),
      color: ok ? 'teal' : 'red',
      autoClose: 1600,
    });
  };

  // Bir bosishda QR generatsiya bo'lib PNG holatida yuklanadi — tasdiqlashsiz.
  const handleDownloadQr = async (item: Source) => {
    if (!item.link) return;
    try {
      const localized = getLocalized(item, 'name', i18n.language);
      const name = localized === '-' ? `manba-${item.id}` : localized;
      await downloadQrPng(item.link, `qr-${name}`);
    } catch {
      notifyError(t('sources.qrError'));
    }
  };

  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<Source | null>(null);
  const [viewItem, setViewItem] = useState<Source | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [formData, setFormData] = useState<SourceFormData>(emptyForm);

  const { data: sources, isLoading } = useQuery<Source[]>({
    queryKey: ['sources'],
    queryFn: sourceAPI.getSources,
  });

  const filteredSources = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return sources ?? [];
    return (sources ?? []).filter((item) =>
      [item.name_uz, item.name_ru, item.name_en, item.link]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(term)),
    );
  }, [sources, search]);

  const sortedSources = useMemo(
    () => filteredSources.slice().sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id)),
    [filteredSources, sortAsc],
  );

  const sourcesTotal = sortedSources.length;
  const sourcesTotalPages = Math.max(1, Math.ceil(sourcesTotal / pageSize));
  const pagedSources = useMemo(
    () => sortedSources.slice((page - 1) * pageSize, page * pageSize),
    [sortedSources, page, pageSize],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: SourcePayload = {
        name_uz: formData.name_uz,
        name_ru: formData.name_ru.trim() || '',
        name_en: formData.name_en.trim() || '',
      };
      return sourceAPI.createSource(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      setShowAddModal(false);
      setEditingItem(null);
      setFormData(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: SourceFormData }) => {
      const apiPayload: SourcePayload = {
        name_uz: payload.name_uz,
        name_ru: payload.name_ru.trim() || '',
        name_en: payload.name_en.trim() || '',
      };
      if (payload.created_at) {
        apiPayload.created_at = new Date(payload.created_at).toISOString();
      }
      if (payload.updated_at) {
        apiPayload.updated_at = new Date(payload.updated_at).toISOString();
      }
      return sourceAPI.updateSource(id, apiPayload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      setShowAddModal(false);
      setEditingItem(null);
      setFormData(emptyForm);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: sourceAPI.deleteSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  const openEditModal = (item: Source) => {
    setEditingItem(item);
    setFormData({
      name_uz: item.name_uz || '',
      name_ru: item.name_ru || '',
      name_en: item.name_en || '',
      created_at: toLocalDateTimeInput(item.created_at),
      updated_at: toLocalDateTimeInput(item.updated_at),
    });
    setShowAddModal(true);
  };

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    }

    if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((p) => p.filter((x) => x !== deleteTarget));
    }

    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const toggleAll = (checked: boolean) =>
    setSelected((current) => {
      const visibleIds = new Set(sortedSources.map((s) => s.id));
      return checked
        ? [...new Set([...current, ...visibleIds])]
        : current.filter((id) => !visibleIds.has(id));
    });

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const resetForm = () => {
    setShowAddModal(false);
    setEditingItem(null);
    setFormData(emptyForm);
  };

  return (
    <section className="users container">
      <h1 className="main-title">{t('sources.title')}</h1>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory">
            <h1>{editingItem ? t('sources.editTitle') : t('sources.addTitle')}</h1>

            <form
              className="subcategory-form"
              onSubmit={(e) => {
                e.preventDefault();

                if (editingItem) {
                  updateMutation.mutate({
                    id: editingItem.id,
                    payload: formData,
                  });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="subcategory-form-group">
                <label>{t('sources.name')} (UZ)</label>
                <input
                  type="text"
                  value={formData.name_uz}
                  onChange={(e) => setFormData({ ...formData, name_uz: e.target.value })}
                  placeholder={t('sources.name')}
                  required
                />
              </div>

              {editingItem && (
                <>
                  <div className="subcategory-form-group">
                    <label>{t('sources.name')} (RU)</label>
                    <input
                      type="text"
                      value={formData.name_ru}
                      onChange={(e) => setFormData({ ...formData, name_ru: e.target.value })}
                      placeholder={t('sources.name')}
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('sources.name')} (EN)</label>
                    <input
                      type="text"
                      value={formData.name_en}
                      onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
                      placeholder={t('sources.name')}
                    />
                  </div>
                </>
              )}

              {editingItem && (
                <>
                  <div className="subcategory-form-group">
                    <label>{t('sources.createdAt')}</label>
                    <input
                      type="datetime-local"
                      value={formData.created_at}
                      onChange={(e) => setFormData({ ...formData, created_at: e.target.value })}
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('sources.updatedAt')}</label>
                    <input
                      type="datetime-local"
                      value={formData.updated_at}
                      onChange={(e) => setFormData({ ...formData, updated_at: e.target.value })}
                    />
                  </div>
                </>
              )}

              <div className="modal-actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t('sources.saving')
                    : t('sources.save')}
                </button>

                <button type="button" className="cancel" onClick={resetForm}>
                  {t('sources.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.source')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name_uz },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
            { label: t('columns.link'), value: renderCell(viewItem, 'link') },
            { label: t('columns.created_at'), value: renderCell(viewItem, 'created_at') },
            { label: t('columns.updated_at'), value: renderCell(viewItem, 'updated_at') },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('sources.confirmDelete')}</h3>

            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('sources.delete')}
              </button>

              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('sources.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="users-filters">
        <input
          type="search"
          value={search}
          placeholder={t('sources.searchPlaceholder')}
          aria-label={t('sources.searchPlaceholder')}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Protected permission="sources.create">
          <button className="add-new-user" onClick={() => setShowAddModal(true)}>
            {t('sources.addBtn')}
          </button>
        </Protected>

        <Protected permission="sources.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('sources.delete')}
          </button>
        </Protected>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={sortedSources.length > 0 && sortedSources.every((s) => selected.includes(s.id))}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              {isVisible('id') && (
                <th className="th-sortable" onClick={() => setSortAsc((p) => !p)}>
                  ID {sortAsc ? '↑' : '↓'}
                </th>
              )}
              {visibleColumns.map((colId) => (
                <th key={colId}>{columnHeader(colId)}</th>
              ))}
              <th>{t('sources.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : sortedSources.length ? (
              pagedSources.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleOne(item.id)}
                    />
                  </td>

                  {isVisible('id') && <td>{item.id}</td>}
                  {visibleColumns.map((colId) => (
                    <td key={colId}>{renderCell(item, colId)}</td>
                  ))}

                  <td className="actions">
                    <Protected permission="sources.show">
                      <button
                        type="button"
                        className="user-view-btn"
                        title={t('viewModal.view')}
                        aria-label={t('viewModal.view')}
                        onClick={() => setViewItem(item)}
                      >
                        <i className="fa-solid fa-eye"></i>
                      </button>
                    </Protected>
                    <Protected permission="sources.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>

                    <Protected permission="sources.delete">
                      <button
                        className="user-delete-btn"
                        onClick={() => {
                          setDeleteTarget(item.id);
                          setShowDeleteModal(true);
                        }}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('sources.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={sourcesTotalPages}
        total={sourcesTotal}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </section>
  );
};

export default Sources;
