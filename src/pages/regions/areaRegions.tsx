import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API } from "../../api/api";
import "./regions.css";
import "../users/users.css";
import { useTranslation } from "react-i18next";
import { Protected } from "../../components/Protected";
import RecordViewModal from "@/components/RecordViewModal/RecordViewModal";
import { getLocalized } from "../../utils/getLocalized";
import TableSkeleton from "../../components/TableSkeleton";
import EmptyState from "../../components/EmptyState";
import { useTableColumns } from "../../hooks/useTableColumns";

interface Region {
  id: number;
  name_uz: string;
  name_ru?: string;
  name_en?: string;
}

const AreaRegions = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('regions');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: Region, colId: string) => {
    switch (colId) {
      case 'name':
        return getLocalized(item, 'name', i18n.language);
      default:
        return '-';
    }
  };
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | "all" | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [regionName, setRegionName] = useState("");
  const [regionNameRu, setRegionNameRu] = useState("");
  const [regionNameEn, setRegionNameEn] = useState("");
  const [editingItem, setEditingItem] = useState<Region | null>(null);
  const [viewItem, setViewItem] = useState<Region | null>(null);

  const { data: regions, isLoading } = useQuery<Region[]>({
    queryKey: ["regions"],
    queryFn: async () => {
      const { data } = await API.get("/regions");
      return data;
    },
  });

  const sortedRegions = useMemo(() => {
    return (regions || []).slice().sort((a, b) => a.id - b.id);
  }, [regions]);

  const namePayload = () => ({
    name: regionName,
    name_uz: regionName,
    name_ru: regionNameRu.trim() || "",
    name_en: regionNameEn.trim() || "",
  });

  const resetForm = () => {
    setShowAddModal(false);
    setRegionName("");
    setRegionNameRu("");
    setRegionNameEn("");
    setEditingItem(null);
  };

  const createMutation = useMutation({
    mutationFn: async () => API.post("/regions", namePayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["regions"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id }: { id: number }) => API.put(`/regions/${id}`, namePayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["regions"] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`/regions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["regions"] });
    },
  });

  const openEditModal = (item: Region) => {
    setEditingItem(item);
    setRegionName(item.name_uz);
    setRegionNameRu(item.name_ru || "");
    setRegionNameEn(item.name_en || "");
    setShowAddModal(true);
  };

  const confirmDelete = () => {
    if (deleteTarget === "all") {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    }

    if (typeof deleteTarget === "number") {
      deleteMutation.mutate(deleteTarget);
      setSelected((p) => p.filter((x) => x !== deleteTarget));
    }

    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? regions?.map((r) => r.id) || [] : []);

  const toggleOne = (id: number) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <section className="users container">
      <h1 className="main-title">{t("aside.regions")}</h1>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="rgn-modal-card">
            <h1 className="rgn-modal-title">{t("aside.regions")}</h1>

            <form
              className="rgn-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingItem) {
                  updateMutation.mutate({ id: editingItem.id });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="rgn-form-group">
                <label>{t("branches.name")} (UZ)</label>

                <input
                  type="text"
                  value={regionName}
                  onChange={(e) => setRegionName(e.target.value)}
                  required
                />
              </div>

              {editingItem && (
                <>
                  <div className="rgn-form-group">
                    <label>{t("branches.name")} (RU)</label>
                    <input
                      type="text"
                      value={regionNameRu}
                      onChange={(e) => setRegionNameRu(e.target.value)}
                    />
                  </div>

                  <div className="rgn-form-group">
                    <label>{t("branches.name")} (EN)</label>
                    <input
                      type="text"
                      value={regionNameEn}
                      onChange={(e) => setRegionNameEn(e.target.value)}
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
                    ? t("expenses.saving")
                    : t("expenses.save")}
                </button>

                <button type="button" className="cancel" onClick={resetForm}>
                  {t("expenses.cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.region')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name_uz },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t("expenses.confirmDelete")}</h3>

            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t("expenses.delete")}
              </button>

              <button
                className="cancel"
                onClick={() => setShowDeleteModal(false)}
              >
                {t("expenses.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="users-filters">
        <Protected permission="regions.create">
          <button className="add-new-user" onClick={() => setShowAddModal(true)}>
            {t("expenses.addBtn")}
          </button>
        </Protected>

        <Protected permission="regions.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget("all");
              setShowDeleteModal(true);
            }}
          >
            {t("expenses.delete")}
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
                  checked={
                    selected.length === (sortedRegions.length || 0) &&
                    (sortedRegions.length || 0) > 0
                  }
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              {isVisible('id') && <th>ID</th>}
              {visibleColumns.map((colId) => (
                <th key={colId}>{columnHeader(colId)}</th>
              ))}
              <th>{t("expenses.actions")}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : sortedRegions.length ? (
              sortedRegions.map((item) => (
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
                    <Protected permission="regions.show">
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
                    <Protected permission="regions.edit">
                      <button
                        className="user-edit-btn"
                        onClick={() => openEditModal(item)}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>

                    <Protected permission="regions.delete">
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
              <EmptyState colSpan={colCount} message={t("regions.notFound")} />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default AreaRegions;
