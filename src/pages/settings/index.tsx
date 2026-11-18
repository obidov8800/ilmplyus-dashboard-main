import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TABLE_PAGES_CONFIG } from "./config";
import type { ColumnConfig } from "./config";
import { useTranslation } from "react-i18next";
// Sarlavha (`.main-title`) va muvaffaqiyat modali (`.modal-overlay`, `.modal
// small`) umumiy dizayn tizimidan — `users.css`da e'lon qilingan, lekin
// import qilinmagan edi.
import "../users/users.css";
import "./settings.css";
import { useTableSettingsStore } from "../../store/useTableSettingsStore";
import {
  TABLE_SETTINGS_KEY,
  fetchAndHydrateTableSettings,
} from "../../hooks/useTableSettingsSync";
import { saveTableSettingsPage } from "./settings.service";
import { usePermission } from "../../hooks/usePermission";
import { Protected } from "../../components/Protected";

interface SavePayload {
  page: string;
  columns: { [key: string]: boolean };
  order: string[];
}

const Settings = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { settings, saveSettings, saveColumnOrder, getColumnOrder, hydrate } =
    useTableSettingsStore();
  // `settings.view` — sahifaga kirish (route darajasida App.tsx da tekshiriladi),
  // `settings.update` — o'zgartirishni saqlash. Ikkinchisi yo'q bo'lsa sahifa
  // faqat o'qish rejimida ochiladi: checkbox/drag bloklanadi, tugma ko'rinmaydi.
  const canEdit = usePermission("settings.update");

  // Backenddagi hujjat (ProtectedRoute bilan bir xil kesh — qo'shimcha so'rov emas).
  // Faqat javob kelganda quyidagi effect qayta ishga tushishi uchun kerak.
  const { data: remoteDoc } = useQuery({
    queryKey: TABLE_SETTINGS_KEY,
    queryFn: fetchAndHydrateTableSettings,
    staleTime: 5 * 60 * 1000,
  });
  const [selectedPage, setSelectedPage] = useState(TABLE_PAGES_CONFIG[0].id);
  const [currentColumns, setCurrentColumns] = useState<{
    [key: string]: boolean;
  }>({});
  const [fixedColumns, setFixedColumns] = useState<ColumnConfig[]>([]);
  const [draggableColumns, setDraggableColumns] = useState<ColumnConfig[]>([]);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Reload on page selection change and when the backend document arrives —
  // NOT on every settings/store change (that would wipe in-progress edits).
  useEffect(() => {
    const pageConfig = TABLE_PAGES_CONFIG.find((p) => p.id === selectedPage);
    if (!pageConfig) return;

    // Load visibility
    const pageSettings = settings[selectedPage] || {};
    const newCols: { [key: string]: boolean } = {};
    pageConfig.columns.forEach((col) => {
      if (!col.alwaysVisible) {
        newCols[col.id] = pageSettings[col.id] ?? true;
      }
    });
    setCurrentColumns(newCols);

    // Separate fixed (id) and draggable columns
    const editableColumns = pageConfig.columns.filter(
      (col) => !col.alwaysVisible,
    );
    const fixed = editableColumns.filter((col) => col.id === "id");
    const draggable = editableColumns.filter((col) => col.id !== "id");

    setFixedColumns(fixed);

    // Load saved order for draggable columns only
    const defaultDraggableOrder = draggable.map((col) => col.id);
    const savedOrder = getColumnOrder(selectedPage, defaultDraggableOrder);

    const orderedDraggable = savedOrder
      .map((colId) => draggable.find((c) => c.id === colId))
      .filter(Boolean) as ColumnConfig[];

    setDraggableColumns(orderedDraggable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPage, remoteDoc]); // Page change + backend javobi

  const handleToggleColumn = (colId: string) => {
    if (!canEdit) return;
    setCurrentColumns((prev) => ({
      ...prev,
      [colId]: !prev[colId],
    }));
  };

  const handleDragStart = useCallback(
    (index: number) => {
      if (!canEdit) return;
      dragItem.current = index;
      setDragIndex(index);
    },
    [canEdit],
  );

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (
      dragItem.current === null ||
      dragOverItem.current === null ||
      dragItem.current === dragOverItem.current
    ) {
      setDragIndex(null);
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }

    const fromIdx = dragItem.current;
    const toIdx = dragOverItem.current;

    setDraggableColumns((prev) => {
      const newList = [...prev];
      const [draggedItem] = newList.splice(fromIdx, 1);
      newList.splice(toIdx, 0, draggedItem);
      return newList;
    });

    dragItem.current = null;
    dragOverItem.current = null;
    setDragIndex(null);
  }, []);

  const { mutate: savePageSettings, isPending: isSaving } = useMutation({
    mutationFn: ({ page, columns, order }: SavePayload) =>
      saveTableSettingsPage(page, { columns, order }),
    onSuccess: (savedDoc, variables) => {
      // Store'ni darhol yangilaymiz — jadval sahifalari shu yerdan o'qiydi.
      saveSettings(variables.page, variables.columns);
      saveColumnOrder(variables.page, variables.order);

      const savedPage =
        savedDoc?.settings[variables.page] ?? savedDoc?.columnOrders[variables.page];

      if (savedDoc && savedPage) {
        // Backend to'liq hujjat qaytardi — o'shani manba sifatida qabul qilamiz.
        hydrate(savedDoc);
        queryClient.setQueryData(TABLE_SETTINGS_KEY, savedDoc);
      } else {
        queryClient.invalidateQueries({ queryKey: TABLE_SETTINGS_KEY });
      }

      setShowSuccessModal(true);
    },
    // Xatolik xabari API interceptor tomonidan ko'rsatiladi; muvaffaqiyat
    // modalini ochmaymiz, chunki sozlama saqlanmagan.
  });

  const handleSave = () => {
    if (!canEdit) return;
    savePageSettings({
      page: selectedPage,
      columns: currentColumns,
      // Save only draggable columns order (id is always first)
      order: draggableColumns.map((col) => col.id),
    });
  };

  const activePageConfig = TABLE_PAGES_CONFIG.find(
    (p) => p.id === selectedPage,
  );

  const getPageLabel = (page: (typeof TABLE_PAGES_CONFIG)[number]) => {
    if (page.labelKey) {
      return t(page.labelKey);
    }
    if (page.id === "classes") {
      return t("aside.groups");
    }
    if (page.id === "expenseCategories") {
      return t("aside.expenseCategory");
    }
    if (page.id === "expenseSubCategories") {
      return t("aside.expenseSubCategory");
    }
    if (page.id === "expenses") {
      return t("aside.expenseCreate");
    }
    return t(`aside.${page.id}`);
  };

  // Sidebar guruhlari. Oxirgi guruh — "qolganlari": config'ga yangi sahifa
  // qo'shilsa, bu yerni tahrirlash shart emas, u avtomatik ko'rinadi.
  const GROUPED_PAGE_IDS: { labelKey: string | null; ids: string[] }[] = [
    { labelKey: null, ids: ["users", "employees", "branches", "roles"] },
    { labelKey: "aside.areas", ids: ["regions", "districts"] },
    {
      labelKey: null,
      ids: [
        "departments",
        "positions",
        "attendance",
        "contracts",
        "payrollAdjustments",
        "faceId",
      ],
    },
    {
      labelKey: null,
      ids: [
        "operators",
        "lid",
        "ipTelephone",
        "refusalReasons",
        "sources",
        "commissions",
      ],
    },
    {
      labelKey: null,
      ids: [
        "courses",
        "levels",
        "coursePrices",
        "groups",
        "academicYears",
        "preschoolPrices",
        "demoLesson",
        "studentTasks",
        "questions",
        "rooms",
      ],
    },
    {
      labelKey: null,
      ids: ["students", "teachers", "studentsContract"],
    },
    { labelKey: null, ids: ["payments"] },
    {
      labelKey: "aside.expenses",
      ids: ["expenseCategories", "expenseSubCategories", "expenses"],
    },
    {
      labelKey: "aside.finances",
      ids: ["financeAccounts", "financeTransfers", "jamgarma", "debts"],
    },
  ];

  const pageGroups = (() => {
    const byId = new Map(TABLE_PAGES_CONFIG.map((page) => [page.id, page]));
    const used = new Set<string>();

    const groups = GROUPED_PAGE_IDS.map((group) => ({
      label: group.labelKey ? t(group.labelKey) : null,
      pages: group.ids.flatMap((id) => {
        const page = byId.get(id);
        if (!page) return [];
        used.add(id);
        return [page];
      }),
    })).filter((group) => group.pages.length > 0);

    const rest = TABLE_PAGES_CONFIG.filter((page) => !used.has(page.id));
    if (rest.length > 0) {
      groups.push({ label: t("settingsGroup.otherPages"), pages: rest });
    }

    return groups;
  })();

  return (
    <section className="settings-page container">
      <h1 className="main-title">{t("settingsGroup.mainTitle")}</h1>

      <div className="settings-layout">
        {/* Left Side: Pages List */}
        <div className="settings-sidebar">
          <h3>{t("settingsGroup.pages")}</h3>
          <div className="settings-page-list">
            {pageGroups.map((group, gIdx) => (
              <div key={gIdx} className="settings-page-group">
                {group.label && (
                  <div className="settings-group-label">{group.label}</div>
                )}
                {group.pages.map((page) => (
                  <button
                    key={page.id}
                    className={`settings-page-btn ${selectedPage === page.id ? "active" : ""}`}
                    onClick={() => setSelectedPage(page.id)}
                  >
                    {getPageLabel(page)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Right Side: Columns Selection + Reorder */}
        <div className="settings-content">
          <div className="settings-content-header">
            <h3>
              {activePageConfig && getPageLabel(activePageConfig)}
              {t("settingsGroup.pageColumnsTitle")}
            </h3>
            <p>{t("settingsGroup.pageColumnsDesc")}</p>
          </div>

          <div className="settings-columns-reorder">
            <div className="settings-columns-info">
              <i
                className={`fa-solid ${canEdit ? "fa-grip-vertical" : "fa-eye"}`}
              ></i>
              <span>
                {canEdit
                  ? t("settingsGroup.dragHint")
                  : t("settingsGroup.readOnlyHint")}
              </span>
            </div>
            <div className="settings-columns-drag-list">
              {/* Fixed ID column — not draggable */}
              {fixedColumns.map((col) => (
                <div key={col.id} className="settings-drag-item fixed">
                  <div className="drag-item-left">
                    <i className="fa-solid fa-lock drag-handle-locked"></i>
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        checked={currentColumns[col.id] || false}
                        onChange={() => handleToggleColumn(col.id)}
                        disabled={!canEdit}
                      />
                      <span className="checkbox-custom"></span>
                      <span className="checkbox-text">
                        {t(`columns.${col.id}`, { defaultValue: col.label })}
                      </span>
                    </label>
                  </div>
                  <span className="drag-item-order fixed-order">—</span>
                </div>
              ))}

              {/* Draggable columns */}
              {draggableColumns.map((col, index) => (
                <div
                  key={col.id}
                  className={`settings-drag-item ${dragIndex === index ? "dragging" : ""} ${
                    canEdit ? "" : "settings-drag-item--locked"
                  }`}
                  draggable={canEdit}
                  onDragStart={() => handleDragStart(index)}
                  onDragEnter={() => handleDragEnter(index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <div className="drag-item-left">
                    <i className="fa-solid fa-grip-vertical drag-handle"></i>
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        checked={currentColumns[col.id] || false}
                        onChange={() => handleToggleColumn(col.id)}
                        disabled={!canEdit}
                      />
                      <span className="checkbox-custom"></span>
                      <span className="checkbox-text">
                        {t(`columns.${col.id}`, { defaultValue: col.label })}
                      </span>
                    </label>
                  </div>
                  <span className="drag-item-order">{index + 1}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-actions">
            <Protected
              permission="settings.update"
              fallback={
                <p className="settings-readonly-note">
                  {t("settingsGroup.readOnlyNote")}
                </p>
              }
            >
              <button
                className="settings-save-btn"
                onClick={handleSave}
                disabled={isSaving}
              >
                {t("settingsGroup.confirm")}
              </button>
            </Protected>
          </div>
        </div>
      </div>

      {showSuccessModal && (
        <div className="modal-overlay">
          <div
            className="modal small"
            style={{ textAlign: "center", padding: "30px" }}
          >
            <div
              style={{
                fontSize: "50px",
                color: "#4CAF50",
                marginBottom: "15px",
              }}
            >
              ✓
            </div>
            <h3 style={{ marginBottom: "20px" }}>
              {t("settingsGroup.saveSuccess")}
            </h3>
            <button
              className="settings-save-btn"
              style={{ width: "100%" }}
              onClick={() => setShowSuccessModal(false)}
            >
              {t("settingsGroup.close")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default Settings;
