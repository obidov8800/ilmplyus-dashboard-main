import { useState } from "react";
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
import { useOptions } from "../../hooks/useOptions";
import { useTableColumns } from "../../hooks/useTableColumns";

interface District {
  id: number;
  name_uz: string;
  name_ru?: string;
  name_en?: string;
  region_id: number;
}

const AreaDistricts = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('districts');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: District, colId: string) => {
    switch (colId) {
      case 'name':
        return getLocalized(item, 'name', i18n.language);
      default:
        return '-';
    }
  };

  const [selectedRegionId, setSelectedRegionId] = useState<string>("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | "all" | null>(null);
  const [selectedDistricts, setSelectedDistricts] = useState<number[]>([]);
  const [districtName, setDistrictName] = useState("");
  const [districtNameRu, setDistrictNameRu] = useState("");
  const [districtNameEn, setDistrictNameEn] = useState("");
  const [editingItem, setEditingItem] = useState<District | null>(null);
  const [viewItem, setViewItem] = useState<District | null>(null);

  const { data: regions } = useOptions("regions");

  const { data: districts, isLoading } = useQuery<District[]>({
    queryKey: ["districts", selectedRegionId],
    queryFn: async () => {
      if (!selectedRegionId) return [];
      const { data } = await API.get(`/regions/${selectedRegionId}/districts`);
      return data;
    },
    enabled: !!selectedRegionId,
  });

  // `name_ru`/`name_en` bo'sh bo'lsa YUBORILMAYDI: backend yangilash qoidasi (`DistrictUpdateRequest`)
  // `sometimes|string` — bo'sh qator null bo'lib, "name ru must be a string" (422) bilan tahrirlashni
  // to'xtatardi (yaratishda esa `nullable`, shu sabab faqat tahrirlashda chiqardi).
  const namePayload = () => ({
    name: districtName,
    name_uz: districtName,
    ...(districtNameRu.trim() ? { name_ru: districtNameRu.trim() } : {}),
    ...(districtNameEn.trim() ? { name_en: districtNameEn.trim() } : {}),
    region_id: Number(selectedRegionId),
  });

  const resetForm = () => {
    setShowAddModal(false);
    setDistrictName("");
    setDistrictNameRu("");
    setDistrictNameEn("");
    setEditingItem(null);
  };

  const createMutation = useMutation({
    mutationFn: async () => API.post("/districts", namePayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["districts", selectedRegionId],
      });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id }: { id: number }) => API.put(`/districts/${id}`, namePayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["districts", selectedRegionId],
      });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`/districts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["districts", selectedRegionId],
      });
    },
  });

  const openEditModal = (item: District) => {
    setEditingItem(item);
    setDistrictName(item.name_uz);
    setDistrictNameRu(item.name_ru || "");
    setDistrictNameEn(item.name_en || "");
    setShowAddModal(true);
  };

  const confirmDelete = () => {
    if (deleteTarget === "all") {
      selectedDistricts.forEach((id) => deleteMutation.mutate(id));
      setSelectedDistricts([]);
    } else if (typeof deleteTarget === "number") {
      deleteMutation.mutate(deleteTarget);
      setSelectedDistricts((p) => p.filter((x) => x !== deleteTarget));
    }
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const toggleAll = (checked: boolean) =>
    setSelectedDistricts(checked ? districts?.map((d) => d.id) || [] : []);

  const toggleOne = (id: number) =>
    setSelectedDistricts((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <section className="users container">
      <h1 className="main-title">{t("aside.districts")}</h1>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="districts-container">
            <h1>{t("aside.districts")}</h1>
            <form
              className="district-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingItem) {
                  updateMutation.mutate({ id: editingItem.id });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="district-form-group">
                <label>{t("branches.name")} (UZ)</label>
                <input
                  type="text"
                  value={districtName}
                  onChange={(e) => setDistrictName(e.target.value)}
                  required
                />
              </div>

              {editingItem && (
                <>
                  <div className="district-form-group">
                    <label>{t("branches.name")} (RU)</label>
                    <input
                      type="text"
                      value={districtNameRu}
                      onChange={(e) => setDistrictNameRu(e.target.value)}
                    />
                  </div>

                  <div className="district-form-group">
                    <label>{t("branches.name")} (EN)</label>
                    <input
                      type="text"
                      value={districtNameEn}
                      onChange={(e) => setDistrictNameEn(e.target.value)}
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
          title={t('viewModal.title.district')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name_uz },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
            {
              label: t('columns.region'),
              value: regions?.find((r) => Number(r.id) === viewItem.region_id)?.label,
            },
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
        <Protected permission="districts.create">
          <button
            className="add-new-user"
            onClick={() => setShowAddModal(true)}
            disabled={!selectedRegionId}
          >
            {t("expenses.addBtn")}
          </button>
        </Protected>

        <Protected permission="districts.delete">
          <button
            className="delete-all"
            disabled={!selectedDistricts.length}
            onClick={() => {
              setDeleteTarget("all");
              setShowDeleteModal(true);
            }}
          >
            {t("expenses.delete")}
          </button>
        </Protected>

        <select
          value={selectedRegionId}
          onChange={(e) => {
            setSelectedRegionId(e.target.value);
            setSelectedDistricts([]);
          }}
        >
            <option value="">{t("aside.regions")}</option>
            {regions?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    selectedDistricts.length === (districts?.length || 0) &&
                    (districts?.length || 0) > 0
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
            ) : districts?.length ? (
              districts?.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedDistricts.includes(item.id)}
                      onChange={() => toggleOne(item.id)}
                    />
                  </td>
                  {isVisible('id') && <td>{item.id}</td>}
                  {visibleColumns.map((colId) => (
                    <td key={colId}>{renderCell(item, colId)}</td>
                  ))}
                  <td className="actions">
                    <Protected permission="districts.show">
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
                    <Protected permission="districts.edit">
                      <button
                        className="user-edit-btn"
                        onClick={() => openEditModal(item)}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>
                    <Protected permission="districts.delete">
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
              <EmptyState
                colSpan={colCount}
                message={
                  selectedRegionId
                    ? t("districts.notFound")
                    : t("districts.choose")
                }
              />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default AreaDistricts;
